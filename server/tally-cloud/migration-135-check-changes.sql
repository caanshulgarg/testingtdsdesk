-- migration-135-check-changes.sql (30-Oct-2026, branch next-check-changes; NOT run on staging: the owner runs it). The owner,
-- 30-Oct-2026: "there should be a button 'check any change'.. if there is any change then it should do it". One button,
-- "Check for changes in Tally" (Books > From Tally, and the client's row on the Tally page), for a period the person picks
-- (this financial year so far, this month, the last 7 days, or a range of their own): the period's days are queued for
-- 133's day check and nothing else is new. The bridge lists each day's heads through the existing older-entries path (no
-- new Tally request; 2 s stop, one request at a time, idle only, postings first, stop when Tally's window holds), and
-- FinCom's copy is corrected to Tally by 133's own functions: added or brought up to date through the one entry path,
-- soft-deleted with history only after two whole-day lists a minute or more apart. Never anything sent to Tally.
--   tally_check_asks   per book: the last press (the period, who, when), for its progress and its result
--   tally_period_skips per book and day: a day of a year chosen in "Bring books from Tally" set aside, not walked in Tally,
--                      because FinCom already holds it (held) or Tally's last list of it matches (matched)
-- The owner again, 30-Oct-2026, 16:30, after "Bring books from Tally" walked every day of a year already uploaded: "I have
-- already uploaded the books.. it shows very few days need books.. why don't we automatically bring only those days instead
-- of all": (1) the From Tally tab's missing days ("N days need a Day Book") are queued by themselves for the same day check
-- (tally_fill_request), so only they are asked of Tally; (2) Check for changes stays the way to compare uploaded days; (3) a
-- full-year Start (tally_period_choose_lean) sets aside the days FinCom holds, "213 days: 206 already in FinCom, 7 to
-- bring"; (4) the Tally computer's office hours are shown for the honest pace.
-- Functions: the app (signed in, the firm's own books): tally_check_request (owner or staff: the press),
-- tally_fill_request (owner or staff: the missing days), tally_period_choose_lean (owner or staff: Start),
-- tally_check_ask_status (any member: progress, time left, results, lists, the missing days, the year in days, the office
-- hours); tally-ingest (service role only): tally_check_next_open (133's tally_check_next, except that a period of "Bring
-- books from Tally" stopped before the press no longer holds the check: a press is the person's fresh choice; a period going
-- still goes first and its choice time is the check's, a period paused still holds it); helpers nobody may call:
-- tally_check_ask_of, tally_book_fetch_of, tally_period_skip_held.
-- Add-only: two new tables (their own grants: service_role only; the app reads through the functions), eight new
-- functions; no existing function or table changed (the press and the missing days write 133's tally_check_runs /
-- tally_check_days as 133's own queue does; a day set aside is written to 98's tally_period_days as counted and done, as 98's
-- own count of it would be). One transaction, lock_timeout 10 s, safe twice. Tested by tests/run_migration135.py. Runs after
-- 133. Deploy order: 135, then the tally-ingest of this branch (without 135 that tally-ingest asks 133's tally_check_next as
-- before).
begin;
set local lock_timeout = '10s';

-- ---------------------------------------------------------------- 1. the table
create table if not exists public.tally_check_asks (
  book_id   uuid primary key references public.tally_books(book_id) on delete cascade,
  firm_id   uuid not null,
  client_id text,
  d_from    date not null,
  d_to      date not null check (d_to >= d_from),
  days      integer not null check (days between 1 and 400),
  asked_by  uuid,
  asked_at  timestamptz not null default now()
);
-- (the owner, 30-Oct-2026, 16:30: "I have already uploaded the books.. why don't we automatically bring only those days
-- instead of all") the days of a year chosen in "Bring books from Tally" that were not walked in Tally because FinCom's
-- copy already holds them: 'held' (entries of the day in FinCom, Tally's list of the day not known) or 'matched' (Tally's
-- last list of the day, taken by a check, matches FinCom's copy); Check for changes in Tally compares them on demand
create table if not exists public.tally_period_skips (
  book_id uuid not null references public.tally_books(book_id) on delete cascade,
  firm_id uuid not null,
  day     date not null,
  why     text not null check (why in ('held', 'matched')),
  at      timestamptz not null default now(),
  primary key (book_id, day)
);
alter table public.tally_check_asks enable row level security;
alter table public.tally_period_skips enable row level security;
-- the new table's own grants: the service role reads and writes; the app reads and presses through the functions below
grant select, insert, update, delete on public.tally_check_asks to service_role;
grant select, insert, update, delete on public.tally_period_skips to service_role;

-- ---------------------------------------------------------------- 2. the helper (granted to nobody)
-- a book's last press: the period, its days (checked, the same, corrected, waiting, to upload by hand), the time left, what
-- holds it (Bring books from Tally going first, or paused; the bridge's stop), and with p_rows the changes made from Tally
-- for it (each with its date, voucher type and number, party, amount); the counts of the changes are the list's own
create or replace function public.tally_check_ask_of(p_book uuid, p_rows boolean) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $function$
declare a tally_check_asks%rowtype; b tally_books%rowtype; c record; g record; r tally_check_runs%rowtype; per jsonb; rows jsonb; up jsonb; rate numeric; eta int; state text;
begin
  select * into a from tally_check_asks where book_id = p_book;
  if not found then return null; end if;
  select * into b from tally_books where book_id = p_book;
  select count(*)::int as total,
         count(*) filter (where done_at is not null and upload_at is null)::int as checked,
         count(*) filter (where done_at is not null and upload_at is null and added + updated + removed = 0)::int as same,
         count(*) filter (where done_at is not null and upload_at is null and added + updated + removed > 0)::int as fixed,
         count(*) filter (where done_at is null and upload_at is null)::int as waiting,
         count(*) filter (where upload_at is not null)::int as upload,
         count(*) filter (where done_at >= a.asked_at)::int as done_n,
         least(30, extract(epoch from now() - min(coalesce(first_asked_at, asked_at))) / 60) as mins
    into c from tally_check_days where book_id = p_book and day between a.d_from and a.d_to and queued_at >= a.asked_at and source = 'check';
  -- the time left: the days done since the press over the minutes since the bridge first took one (two minutes measured)
  rate := case when c.mins >= 2 and c.done_n > 0 then c.done_n / c.mins end;
  eta := case when c.waiting > 0 and rate > 0 then greatest(1, round(c.waiting / rate))::int end;
  state := case when c.total = 0 then 'queued' when c.waiting = 0 then 'done' when c.checked + c.upload > 0 then 'checking' else 'queued' end;
  select coalesce(jsonb_agg(jsonb_build_object('day', to_char(d.day, 'YYYYMMDD'), 'words', d.upload_words) order by d.day), '[]'::jsonb) into up
    from tally_check_days d where d.book_id = p_book and d.day between a.d_from and a.d_to and d.queued_at >= a.asked_at and d.source = 'check' and d.upload_at is not null;
  select * into r from tally_check_runs where book_id = p_book;
  per := case when exists (select 1 from tally_period_pulls p where p.book_id = p_book) then tally_period_status_of(p_book)->'pull' end;
  select coalesce(jsonb_agg(jsonb_build_object('at', z.at, 'day', to_char(z.day, 'YYYY-MM-DD'), 'vtype', coalesce(z.vtype, ''), 'vno', coalesce(z.vno, ''), 'party', coalesce(z.party, ''),
           'amount', (select round(sum(abs(l.amount)) / 2, 2) from tally_lines l where l.book_id = p_book and l.guid = z.guid), 'what', z.what) order by z.day, z.at, z.guid), '[]'::jsonb) as rows,
         count(*) filter (where z.what = 'added')::int as added, count(*) filter (where z.what = 'changed')::int as changed, count(*) filter (where z.what = 'deleted')::int as deleted
    into g
    from (select l.at, coalesce(l.day, v.day) as day, v.vtype, v.vno, v.party, l.what, l.guid
            from tally_fetch_log l left join tally_vouchers v on v.book_id = l.book_id and v.guid = l.guid
           where l.book_id = p_book and l.via = 'check' and l.at >= a.asked_at and l.day between a.d_from and a.d_to
           order by l.day, l.at limit 2000) z;
  return jsonb_build_object('book', p_book, 'client', b.client_id, 'company', b.company, 'from', to_char(a.d_from, 'YYYYMMDD'), 'to', to_char(a.d_to, 'YYYYMMDD'),
    'days', a.days, 'at', a.asked_at, 'state', state, 'total', c.total, 'checked', c.checked, 'same', c.same, 'fixed', c.fixed, 'waiting', c.waiting, 'upload', c.upload,
    'etaMin', eta, 'added', g.added, 'changed', g.changed, 'deleted', g.deleted, 'uploadDays', up,
    'after', coalesce(per->>'state' = 'going' and not coalesce((per->>'done')::boolean, false), false) and c.waiting > 0,
    'paused', coalesce(per->>'state' = 'paused', false) and c.waiting > 0,
    'run', case when r.book_id is not null then jsonb_build_object('state', r.state, 'why', r.stop_why, 'words', r.stop_words, 'at', r.stopped_at) end)
    || case when p_rows then jsonb_build_object('rows', g.rows) else '{}'::jsonb end;
end $function$;

-- a book's other lines (any member): the missing days being brought (fill: queued by the From Tally tab from the "N days
-- need a Day Book" list in the last day), the year chosen in "Bring books from Tally" in days (lean: "213 days: 206 already
-- in FinCom, 7 to bring"), and the office hours of the Tally computer that has the company (hours: the honest pace; up
-- to 30 days an answer outside them, 3 inside)
create or replace function public.tally_book_fetch_of(p_book uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $function$
declare b tally_books%rowtype; c record; fill jsonb; lean jsonb; hrs jsonb; p tally_period_pulls%rowtype; fy_to date; today date := (now() at time zone 'Asia/Kolkata')::date;
  ydays int; al int; up int; sk int; rate numeric; ad int; ch int; dl int;
begin
  select * into b from tally_books where book_id = p_book;
  if not found then return null; end if;
  select count(*)::int as total, count(*) filter (where done_at is not null and upload_at is null)::int as done_n, count(*) filter (where done_at is null and upload_at is null)::int as waiting,
         count(*) filter (where upload_at is not null)::int as upload, min(queued_at) as q0,
         least(30, extract(epoch from now() - min(coalesce(first_asked_at, asked_at))) / 60) as mins
    into c from tally_check_days where book_id = p_book and source = 'fill' and queued_at > now() - interval '1 day';
  if c.total > 0 then
    rate := case when c.mins >= 2 and c.done_n > 0 then c.done_n / c.mins end;
    select count(*) filter (where l.what = 'added')::int, count(*) filter (where l.what = 'changed')::int, count(*) filter (where l.what = 'deleted')::int into ad, ch, dl
      from tally_fetch_log l where l.book_id = p_book and l.via = 'check' and l.at >= c.q0
       and l.day in (select x.day from tally_check_days x where x.book_id = p_book and x.source = 'fill' and x.queued_at > now() - interval '1 day');
    fill := jsonb_build_object('total', c.total, 'done', c.done_n, 'waiting', c.waiting, 'upload', c.upload, 'at', c.q0, 'added', ad, 'changed', ch, 'deleted', dl,
      'etaMin', case when c.waiting > 0 and rate > 0 then greatest(1, round(c.waiting / rate))::int end);
  end if;
  select * into p from tally_period_pulls where book_id = p_book;
  if found then
    fy_to := (p.fy_start + interval '1 year' - interval '1 day')::date;
    ydays := greatest(0, least(fy_to, today) - p.fy_start + 1);
    select count(*) filter (where d.done_at is not null and d.upload_at is null)::int, count(*) filter (where d.upload_at is not null)::int into al, up
      from tally_period_days d where d.book_id = p_book and d.day between p.fy_start and least(fy_to, today);
    select count(*)::int into sk from tally_period_skips s where s.book_id = p_book and s.day between p.fy_start and least(fy_to, today);
    lean := jsonb_build_object('fy', to_char(p.fy_start, 'YYYYMMDD'), 'days', ydays, 'already', al, 'upload', up, 'toBring', greatest(0, ydays - al - up), 'skipped', sk);
  end if;
  select jsonb_build_object('from', d.period_night_from, 'to', d.period_night_to, 'sunday', d.period_night_sunday) into hrs
    from tally_devices d where d.firm_id = b.firm_id and not coalesce(d.revoked, false)
   order by (d.id in (select x.device_id from tally_companies x where x.book_id = p_book and x.device_id is not null)) desc, coalesce(d.period_fetch, false) desc, d.id limit 1;
  return jsonb_build_object('book', p_book, 'client', b.client_id, 'company', b.company, 'fill', fill, 'lean', lean, 'hours', hrs);
end $function$;

-- the year's days FinCom already holds, set aside before "Bring books from Tally" walks the year (no Tally request for
-- them): a day with live entries in FinCom whose Tally list is not known (held), or whose last list taken by a check
-- matches FinCom's copy (matched: every entry held at its AlterID and no live entry Tally did not list); a day already
-- counted, marked to upload, or with no entries in FinCom is left to be walked. Counted as Tally's own count would be
-- (tally_n = FinCom's entries, done), so 98's own functions never hand it out
create or replace function public.tally_period_skip_held(p_book uuid) returns integer
language plpgsql security definer set search_path = public, pg_temp as $function$
declare p tally_period_pulls%rowtype; fy_to date; today date := (now() at time zone 'Asia/Kolkata')::date; x record; h record; n int := 0; extra int;
begin
  select * into p from tally_period_pulls where book_id = p_book;
  if not found then return 0; end if;
  fy_to := (p.fy_start + interval '1 year' - interval '1 day')::date;
  for x in select v.day, count(*)::int as k from tally_vouchers v
            where v.book_id = p_book and v.deleted_at is null and v.day between p.fy_start and least(fy_to, today)
              and not exists (select 1 from tally_period_days d where d.book_id = p_book and d.day = v.day and (d.tally_n is not null or d.upload_at is not null))
            group by v.day loop
    select c.heads, c.seen, c.via into h from tally_check_days c where c.book_id = p_book and c.day = x.day and c.heads is not null and c.listed_at is not null and c.upload_at is null;
    if found then
      select count(*)::int into extra from tally_vouchers v where v.book_id = p_book and v.day = x.day and v.deleted_at is null and not coalesce(v.optional, false)
         and not exists (select 1 from jsonb_array_elements(h.heads) e where jsonb_typeof(e) = 'array' and e->>0 = v.guid);
      if extra > 0 or (select held from tally_period_held(p_book, h.heads, 0, h.seen)) < jsonb_array_length(h.heads) then continue; end if;
      insert into tally_period_days (book_id, firm_id, day, tally_n, held_n, heads, via, counted_at, done_at)
      values (p_book, p.firm_id, x.day, jsonb_array_length(h.heads), jsonb_array_length(h.heads), h.heads, h.via, now(), now())
      on conflict (book_id, day) do update set tally_n = excluded.tally_n, held_n = excluded.held_n, heads = excluded.heads, via = excluded.via, counted_at = now(), done_at = now()
        where tally_period_days.upload_at is null and tally_period_days.tally_n is null;
      insert into tally_period_skips (book_id, firm_id, day, why) values (p_book, p.firm_id, x.day, 'matched') on conflict (book_id, day) do update set why = 'matched', at = now();
    else
      insert into tally_period_days (book_id, firm_id, day, tally_n, held_n, counted_at, done_at)
      values (p_book, p.firm_id, x.day, least(x.k, 100000), least(x.k, 100000), now(), now())
      on conflict (book_id, day) do update set tally_n = excluded.tally_n, held_n = excluded.held_n, counted_at = now(), done_at = now()
        where tally_period_days.upload_at is null and tally_period_days.tally_n is null;
      insert into tally_period_skips (book_id, firm_id, day, why) values (p_book, p.firm_id, x.day, 'held') on conflict (book_id, day) do update set why = 'held', at = now();
    end if;
    n := n + 1;
  end loop;
  return n;
end $function$;

-- ---------------------------------------------------------------- 3. the app
-- the press: the client's book (the firm's own), the period cut to the days the books hold (not before the books start,
-- not after today in India), at most 400 days; the days queued for 133's check afresh (as 133's tally_check_queue queues an
-- upload's), the check going under a new choice time when it was stopped or "Bring books from Tally" is not going (the
-- person's fresh choice: the bridge reads the company again); a period going keeps its choice time (one stop rule)
create or replace function public.tally_check_request(p_client text, p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); bk uuid; b tally_books%rowtype; lo date; a date; z date; n int; today date := (now() at time zone 'Asia/Kolkata')::date; ps text;
begin
  if f is null then raise exception 'not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and m.active and m.role in ('owner', 'staff')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select x.book_id into bk from tally_books x where x.firm_id = f and x.client_id = p_client order by x.from_date desc nulls last, x.book_id limit 1;
  if bk is null then return jsonb_build_object('ok', false, 'error', 'This client''s books are not linked to Tally yet.'); end if;
  perform tally_period_member(bk, true);
  select * into b from tally_books where book_id = bk;
  if p_from is null or p_to is null then return jsonb_build_object('ok', false, 'error', 'Choose the period to check: a first day and a last day.'); end if;
  if p_from > p_to then return jsonb_build_object('ok', false, 'error', 'The first day must be on or before the last day.'); end if;
  -- the days the books hold, or that Tally has listed for them: from the books' start (or an earlier day held), to today
  lo := least(b.from_date, (select min(v.day) from tally_vouchers v where v.book_id = bk and v.deleted_at is null),
              (select min(d.day) from tally_period_days d where d.book_id = bk and d.tally_n > 0));
  a := greatest(p_from, coalesce(lo, p_from)); z := least(p_to, today);
  if z < a then
    return jsonb_build_object('ok', false, 'error', case when p_from > today then 'That period has not begun yet.'
      else 'FinCom holds no books of this client for that period: the books start on ' || to_char(lo, 'DD-Mon-YYYY') || '.' end);
  end if;
  if z - a + 1 > 400 then return jsonb_build_object('ok', false, 'error', 'Choose at most 400 days at a time (a financial year fits).'); end if;
  perform pg_advisory_xact_lock(hashtext('tally_check_request:' || bk::text));
  insert into tally_check_days (book_id, firm_id, day, source, queued_at)
  select bk, f, d::date, 'check', now() from generate_series(a, z, interval '1 day') d
  on conflict (book_id, day) do update set source = excluded.source, queued_at = now(), asked_at = null, first_asked_at = null, lists = 0, tally_n = null, heads = null, via = null,
    listed_at = null, gone1 = null, gone1_at = null, added = 0, updated = 0, removed = 0, same = null, done_at = null, upload_at = null, upload_words = null;
  get diagnostics n = row_count;
  select state into ps from tally_period_pulls where book_id = bk;
  insert into tally_check_runs (book_id, firm_id) values (bk, f) on conflict (book_id) do nothing;
  update tally_check_runs set state = 'going', chosen_at = now(), stopped_at = null, stop_day = null, stop_why = null, stop_words = null
   where book_id = bk and (state <> 'going' or coalesce(ps, '') <> 'going');
  insert into tally_check_asks (book_id, firm_id, client_id, d_from, d_to, days, asked_by, asked_at) values (bk, f, b.client_id, a, z, n, auth.uid(), now())
  on conflict (book_id) do update set client_id = excluded.client_id, d_from = excluded.d_from, d_to = excluded.d_to, days = excluded.days, asked_by = excluded.asked_by, asked_at = excluded.asked_at;
  return jsonb_build_object('ok', true) || tally_check_ask_of(bk, false);
end $function$;

-- "Bring books from Tally" Start (the owner, 30-Oct-2026, 16:30): 98's tally_period_choose, then the days FinCom already
-- holds set aside (tally_period_skip_held) so only the days FinCom lacks are walked in Tally; the answer is 98's status
-- with the year in days ("213 days: 206 already in FinCom, 7 to bring")
create or replace function public.tally_period_choose_lean(p_book uuid, p_fy_start date, p_part text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := tally_period_member(p_book, true); res jsonb; n int;
begin
  res := tally_period_choose(p_book, p_fy_start, p_part);
  if not coalesce((res->>'ok')::boolean, false) then return res; end if;
  perform pg_advisory_xact_lock(hashtext('tally_period_skip_held:' || p_book::text));
  n := tally_period_skip_held(p_book);
  return tally_period_status_of(p_book) || jsonb_build_object('setAside', n, 'lean', tally_book_fetch_of(p_book)->'lean');
end $function$;

-- the missing days (the From Tally tab's "N days need a Day Book": days with no entries in FinCom's copy, held recorder
-- days, the cloud's gap), brought from Tally by themselves: queued for 133's day check (Tally's list of the day, the
-- entries FinCom lacks read, nothing walked that FinCom holds). Owner or staff (the tab asks by itself when the list is not
-- empty and the computer's switch is on). Cut to the days the books hold and to today, at most 400 (the newest); never a
-- day being checked, marked to upload by hand, or done in the last 6 hours (so the tab asking again walks nothing twice).
-- A check the bridge stopped (Tally busy) stays stopped: only the person's press goes on
create or replace function public.tally_fill_request(p_client text, p_days date[]) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); bk uuid; b tally_books%rowtype; lo date; n int; today date := (now() at time zone 'Asia/Kolkata')::date; p tally_period_pulls%rowtype;
begin
  if f is null then raise exception 'not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and m.active and m.role in ('owner', 'staff')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select x.book_id into bk from tally_books x where x.firm_id = f and x.client_id = p_client order by x.from_date desc nulls last, x.book_id limit 1;
  if bk is null then return jsonb_build_object('ok', false, 'error', 'This client''s books are not linked to Tally yet.'); end if;
  select * into b from tally_books where book_id = bk;
  lo := least(b.from_date, (select min(v.day) from tally_vouchers v where v.book_id = bk and v.deleted_at is null));
  perform pg_advisory_xact_lock(hashtext('tally_check_request:' || bk::text));
  insert into tally_check_days (book_id, firm_id, day, source, queued_at)
  select bk, f, d, 'fill', now()
    from (select distinct d from unnest(coalesce(p_days, '{}'::date[])) d where d is not null and d <= today and (lo is null or d >= lo) order by d desc limit 400) z
  on conflict (book_id, day) do update set source = excluded.source, queued_at = now(), asked_at = null, first_asked_at = null, lists = 0, tally_n = null, heads = null, via = null,
    listed_at = null, gone1 = null, gone1_at = null, added = 0, updated = 0, removed = 0, same = null, done_at = null, upload_at = null, upload_words = null
    where tally_check_days.upload_at is null and tally_check_days.done_at is not null and tally_check_days.done_at < now() - interval '6 hours';
  get diagnostics n = row_count;
  insert into tally_check_runs (book_id, firm_id) values (bk, f) on conflict (book_id) do nothing;
  -- "Bring books from Tally" stopped by the person: the missing days go on under a new choice time (a bridge's stop holds)
  select * into p from tally_period_pulls where book_id = bk;
  if n > 0 and found and p.state = 'stopped' and p.stop_why = 'person' then
    update tally_check_runs set chosen_at = now() where book_id = bk and state = 'going' and chosen_at <= coalesce(p.stopped_at, p.chosen_at);
  end if;
  return jsonb_build_object('ok', true, 'queued', n, 'fill', tally_book_fetch_of(bk)->'fill');
end $function$;

-- the presses of the firm's books (p_client null: each book's, no list), or the client's with its list of changes
create or replace function public.tally_check_ask_status(p_client text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); out jsonb;
begin
  if f is null then raise exception 'not allowed' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(tally_check_ask_of(k.book_id, p_client is not null) order by k.asked_at desc), '[]'::jsonb) into out
    from tally_check_asks k join tally_books b on b.book_id = k.book_id
   where b.firm_id = f and k.firm_id = f and (p_client is null or b.client_id = p_client);
  return jsonb_build_object('ok', true, 'asks', out,
    'books', (select coalesce(jsonb_agg(tally_book_fetch_of(b.book_id) order by b.company, b.book_id), '[]'::jsonb) from tally_books b where b.firm_id = f and (p_client is null or b.client_id = p_client)));
end $function$;

-- ---------------------------------------------------------------- 4. tally-ingest (service role only)
-- 133's tally_check_next, except a period of "Bring books from Tally" that was stopped (by the person, or by the bridge
-- because Tally was busy) before the check's last choice no longer holds it: a press is the person's fresh choice. A period
-- going: its choice time (the bridge reads the period's days first; the check's in the room left). A period paused, a
-- period stopped after the check's choice, or the check stopped: none
create or replace function public.tally_check_next_open(p_book uuid, p_max integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $function$
declare r tally_check_runs%rowtype; p tally_period_pulls%rowtype; has_p boolean; ca timestamptz; out jsonb := '[]'::jsonb; d date; lim int := least(greatest(coalesce(p_max, 3), 0), 30);
  today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into r from tally_check_runs where book_id = p_book;
  if not found or r.state <> 'going' or lim = 0 then return out; end if;
  select * into p from tally_period_pulls where book_id = p_book;
  has_p := found;
  if has_p and p.state = 'paused' then return out; end if;
  if has_p and p.state = 'stopped' and not (r.chosen_at > coalesce(p.stopped_at, p.chosen_at)) then return out; end if;
  ca := case when has_p and p.state = 'going' then p.chosen_at else r.chosen_at end;
  for d in select x.day from tally_check_days x where x.book_id = p_book and x.done_at is null and x.upload_at is null and x.day <= today
            order by (x.asked_at is not null and x.asked_at > now() - interval '2 minutes'), x.day desc limit lim loop
    out := out || jsonb_build_array(jsonb_build_object('day', to_char(d, 'YYYYMMDD'), 'fetch', true, 'chosenAt', ca, 'check', true));
  end loop;
  update tally_check_days x set asked_at = now(), first_asked_at = coalesce(x.first_asked_at, now())
   where x.book_id = p_book and x.day in (select to_date(e->>'day', 'YYYYMMDD') from jsonb_array_elements(out) e);
  return out;
end $function$;

-- ---------------------------------------------------------------- 5. who may call
revoke all on function public.tally_check_ask_of(uuid, boolean), public.tally_book_fetch_of(uuid), public.tally_period_skip_held(uuid) from public, anon, authenticated, service_role;
revoke all on function public.tally_check_next_open(uuid, integer) from public, anon, authenticated;
grant execute on function public.tally_check_next_open(uuid, integer) to service_role;
revoke all on function public.tally_check_request(text, date, date), public.tally_check_ask_status(text), public.tally_period_choose_lean(uuid, date, text), public.tally_fill_request(text, date[]) from public, anon;
grant execute on function public.tally_check_request(text, date, date), public.tally_check_ask_status(text), public.tally_period_choose_lean(uuid, date, text), public.tally_fill_request(text, date[]) to authenticated, service_role;

commit;
