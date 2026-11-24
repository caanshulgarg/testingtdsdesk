-- migration-222-tally-autoday.sql (24-Nov-2026, branch next-tally-tell-sql; NOT run anywhere: the coordinator applies it
-- after review, after 221). The owner, 24-Nov-2026: "There should be proper way to tell and auto import of tally days into
-- fincom." Plan: tally-tell-autoday-plan.md, part B (B.1 the days needed and their order, B.2 this file, B.5 retries,
-- B.6 the delete guards, B.8 days before the book's first day). FinCom brings the days it needs from Tally by itself,
-- through the one existing day path (tally_check_days -> tally_days_claim -> tally_check_next_open -> the bridge's
-- FinComDayHeads / FinComDayHeadsPart / FinComVoucherBatch / FinComVoucherObject -> tally_check_heads, tally_check_entries).
-- No Tally request is added or changed; the pace and every gate stay where they are (the bridge's and tally-ingest's).
--   tally_check_days       + prio (1 held, 2 delete, 3 gap, 4 future, 5 fill / upload / check), tries, next_at, last_why,
--                          parked_at (a book no longer linked: its days parked, not counted, not handed)
--   tally_period_pulls     + auto_tries (a period a bridge stopped at 2 s, started again after 1 h, 3 h, then 24 h)
--   tally_autoday_queue(p_book)    (tally-ingest, service role; memoised per book per 10 minutes) and
--   tally_autoday_sweep()          (pg_cron 'tally-autoday' every 15 minutes and 'tally-autoday-night' at 00:07 India time;
--                                   granted to nobody; 20 s a run): for each book, held lines' days (prio 1), possible
--                                   deletes (2), future-dated lines on their own date (4), the check and the period kept
--                                   going, a book's days parked when its link goes and back when linked again, the days
--                                   before the book's first day read into the client's earlier book or closed with words.
--   tally_autoday_pickup(p_book, p_day, p_code)   (tally-ingest, service role): a bridge's pickup word for a handed day;
--                                   a 2 s stop ('slow', 'dayRetry', 'over2s', 'window', 'stopped') waits 1 h, 3 h, 24 h.
--   tally_check_heads(p_book, p_day, p_heads, p_via, p_bands)   (new, service role): a heavy day read in MasterID bands is
--                                   a whole list only when its bands run from 1 end to end with no hole; else no delete.
-- Replaced, each only while its text is the one staging runs (md5 checked; else the file stops, nothing changed), each with
-- its own text kept and every changed line marked "222": tally_check_next_open (182's: prio first; parked, held-back and
-- pre-start days skipped; a bridge's stop no longer stops the hand-out, only a person's), tally_check_stop (182's: the day
-- waits instead of the whole check stopping), tally_check_heads (133's: no delete of a FinCom posting not settled or settled
-- under 10 minutes ago; 'bands' never whole by itself; an unfinished day waits instead of asking for an upload),
-- tally_recorder_fetching_sweep (196's: a line goes 'stale' only once its day was listed after it came),
-- tally_held_status (196's) and tally_check_status_of (182's): their words never ask for an upload; tally_period_day_stop
-- (197's): a slow day waits 1 h, 3 h, then 24 h, and its 3rd try no longer marks it "to upload".
-- ADD-ONLY: seven columns added, no table made, no row deleted, nothing dropped; one data step (1b) opens the days given
-- up to an upload again. A name guard stops the file when a name it
-- makes is used by something that is not this migration's. One transaction, lock_timeout 10 s, safe twice. Tested by
-- tests/run_migration222.py (on tests/tell_stand.py).
-- APPLIED TOGETHER: 221 then 222 at once, and only with the tally-ingest deploy that hands the days FinCom queues by
-- itself only to bridges of 2.5.16 or later (next-tally-tell-ingest). Never 222 alone.
-- Contract for a heavy day read in MasterID bands (bridge 2.5.19+): the bridge sends bands: [[from, to | null], ...]
-- with its period_heads; tally-ingest calls the 5-argument tally_check_heads(..., 'bands', p_bands) only when the bands
-- are there, and keeps today's 'day' mapping for an older bridge. A 'bands' list without its bands is taken as today
-- (a whole list), so a heavy day is never held for ever; with its bands, a hole means no delete.
-- Review of 24-Nov-2026 (NOT READY, fixed here): days given up to an upload opened again once (a data step) and the
-- period's 'slow3' days retried; a hand-out never counted as a try; the night job at 00:07 India time (pg_cron is UTC);
-- days before the book: only into a LINKED earlier book, the book's own closed ('before_book'); no delete of an entry
-- with a recorder line still being brought, nor from an empty list before a third one 10 minutes on; the sweep 5 s a run;
-- 31 days for the daily re-check; the period's auto_tries reset once it reads again; no word asks for an upload;
-- the fetching sweep needs a whole ('day') list; the types of existing columns and the job names guarded.
-- Re-review: the period days' kept upload words said plainly (a data step), the locked words of tally_period_entries and
-- tally_period_next_paced too, and a locked period day read again once its month is unlocked.
-- Ingest review: tally_days_claim(..., p_auto) and tally_check_next_open(..., p_auto): with p_auto false (a bridge before
-- 2.5.16) only upload, check and fill days are claimed, so FinCom's own days are never held from a newer bridge; the
-- 7- and 2-argument calls as before. A given-up period day (over2s, dates, shape, toomany, entries, payroll, other) is
-- read again as a check day under the backoff and unmarked once that day is read whole.
begin;
set local lock_timeout = '10s';

-- ---------------------------------------------------------------- 0. the names, and the texts replaced
do $names$
declare fn text; bad text[] := '{}'; x record;
begin
  foreach fn in array array['tally_autoday_backoff', 'tally_autoday_prio', 'tally_autoday_fy', 'tally_autoday_words', 'tally_autoday_fresh_post', 'tally_autoday_bands_whole',
                            'tally_autoday_put', 'tally_autoday_queue_of', 'tally_autoday_queue', 'tally_autoday_sweep', 'tally_autoday_pickup'] loop
    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = fn
                and coalesce(obj_description(p.oid, 'pg_proc'), '') <> 'tally autoday (migration 222)') then bad := bad || ('function ' || fn); end if;
  end loop;
  -- each function replaced: only while it is the text staging runs (read 24-Nov-2026), or this migration's own
  for x in select * from (values ('tally_check_next_open(uuid,integer)', '341d459bfdeacbc619fcd97e535f98f8'),
                                 ('tally_check_stop(uuid,date,text,text,timestamp with time zone)', '348cebf2e5551b772021f68598f74a83'),
                                 ('tally_check_heads(uuid,date,jsonb,text)', '056a70c490c8681a1c8b55240425b7d6'),
                                 ('tally_recorder_fetching_sweep(integer)', '162277df8a310baca3c012c242879014'),
                                 ('tally_held_status(text)', '2d2abcd9dcbd0c738553d72f176f4e0c'),
                                 ('tally_check_status_of(uuid)', 'a42410209eda217c9713d61ede864027'),
                                 ('tally_period_day_stop(uuid,date,text)', '4a6af131af1ea7b85fa489971ce24f53'),
                                 ('tally_check_entries(uuid,date,jsonb,jsonb,jsonb)', 'ecf3e93ef5c2b0247c76057d8eb15f79'),
                                 ('tally_period_upload(uuid,date,text,text,text)', 'b2fb148cbf59ea6e8b8cb2da7d98af6f'),
                                 ('tally_period_entries(uuid,date,jsonb,jsonb,jsonb,jsonb)', 'b00e21e799c9e2b0eaf8226f4aed1dee'),
                                 ('tally_period_next_paced(uuid,integer,boolean)', '9acd298c3746463a698fa7dd430840ff'),
                                 ('tally_days_claim(uuid,uuid,uuid,text,text,integer,boolean)', 'de2ea89eeae9a6bd2265c0a8e866720e')) v(sig, h) loop
    if to_regprocedure('public.' || x.sig) is null then bad := bad || ('function ' || x.sig || ' (missing)');
    elsif not exists (select 1 from pg_proc p where p.oid = to_regprocedure('public.' || x.sig)
                       and (md5(p.prosrc) = x.h or coalesce(obj_description(p.oid, 'pg_proc'), '') = 'tally autoday (migration 222)')) then
      bad := bad || ('function ' || x.sig || ' (not the text staging runs)');
    end if;
  end loop;
  -- tally_days_claim and tally_check_next_open: their own argument lists, and this migration's with p_auto; no other
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'tally_days_claim'
              and p.oid not in (coalesce(to_regprocedure('public.tally_days_claim(uuid,uuid,uuid,text,text,integer,boolean)'), 0), coalesce(to_regprocedure('public.tally_days_claim(uuid,uuid,uuid,text,text,integer,boolean,boolean)'), 0))) then
    bad := bad || 'function tally_days_claim (another argument list)'::text;
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'tally_check_next_open'
              and p.oid not in (coalesce(to_regprocedure('public.tally_check_next_open(uuid,integer)'), 0), coalesce(to_regprocedure('public.tally_check_next_open(uuid,integer,boolean)'), 0))) then
    bad := bad || 'function tally_check_next_open (another argument list)'::text;
  end if;
  for x in select * from (values ('tally_days_claim(uuid,uuid,uuid,text,text,integer,boolean,boolean)'), ('tally_check_next_open(uuid,integer,boolean)')) v(sig) loop
    if to_regprocedure('public.' || x.sig) is not null and coalesce(obj_description(to_regprocedure('public.' || x.sig), 'pg_proc'), '') <> 'tally autoday (migration 222)' then
      bad := bad || ('function ' || x.sig);
    end if;
  end loop;
  -- tally_check_heads: the 4-argument one above, and this migration's 5-argument one; no other
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'tally_check_heads'
              and p.oid not in (coalesce(to_regprocedure('public.tally_check_heads(uuid,date,jsonb,text)'), 0), coalesce(to_regprocedure('public.tally_check_heads(uuid,date,jsonb,text,jsonb)'), 0))) then
    bad := bad || 'function tally_check_heads (another argument list)'::text;
  end if;
  if to_regprocedure('public.tally_check_heads(uuid,date,jsonb,text,jsonb)') is not null
     and coalesce(obj_description(to_regprocedure('public.tally_check_heads(uuid,date,jsonb,text,jsonb)'), 'pg_proc'), '') <> 'tally autoday (migration 222)' then
    bad := bad || 'function tally_check_heads(uuid,date,jsonb,text,jsonb)'::text;
  end if;
  if to_regprocedure('public.tally_held_queue_of(uuid,date[])') is null or to_regclass('public.tally_period_pulls') is null or to_regclass('public.tally_check_runs') is null
     or to_regclass('public.tally_period_day_retry') is null then
    bad := bad || 'tally_held_queue_of / tally_period_pulls / tally_check_runs / tally_period_day_retry (missing: run 98, 133, 196 and 197 first)'::text;
  end if;
  -- a column this file adds that is there already must be of its type
  for x in select * from (values ('tally_check_days', 'prio', 'smallint'), ('tally_check_days', 'tries', 'integer'), ('tally_check_days', 'next_at', 'timestamp with time zone'),
                                 ('tally_check_days', 'last_why', 'text'), ('tally_check_days', 'parked_at', 'timestamp with time zone'), ('tally_check_days', 'empty_lists', 'smallint'),
                                 ('tally_period_pulls', 'auto_tries', 'integer')) v(tb, col, ty) loop
    if exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = x.tb and c.column_name = x.col and c.data_type <> x.ty) then
      bad := bad || ('column ' || x.tb || '.' || x.col || ' (not ' || x.ty || ')');
    end if;
  end loop;
  -- the cron jobs' names: absent, or this migration's own command
  if to_regclass('cron.job') is not null then
    if exists (select 1 from cron.job j where j.jobname in ('tally-autoday', 'tally-autoday-night') and j.command <> 'select public.tally_autoday_sweep()') then
      bad := bad || 'cron job tally-autoday / tally-autoday-night (another command)'::text;
    end if;
  end if;
  if array_length(bad, 1) > 0 then
    raise exception 'migration 222: these names are already used by something else: %. Nothing was changed.', array_to_string(bad, ', ');
  end if;
end $names$;

-- ---------------------------------------------------------------- 1. the columns
alter table public.tally_check_days add column if not exists prio smallint not null default 5 check (prio between 1 and 9);
alter table public.tally_check_days add column if not exists tries int not null default 0 check (tries >= 0);
alter table public.tally_check_days add column if not exists next_at timestamptz;                -- null: now
alter table public.tally_check_days add column if not exists last_why text check (last_why is null or length(last_why) <= 40);
alter table public.tally_check_days add column if not exists parked_at timestamptz;              -- the book no longer linked
alter table public.tally_check_days add column if not exists empty_lists smallint not null default 0 check (empty_lists >= 0);   -- whole lists in a row that listed nothing
alter table public.tally_period_pulls add column if not exists auto_tries int not null default 0 check (auto_tries >= 0);

-- ---------------------------------------------------------------- 1b. once: the days given up to an upload before 222
-- every check day marked "upload the Day Book" (not for a locked month) is opened again, to be read by itself now; the
-- period's days a slow Tally gave up on ('slow3', 197) lose that mark and are retried now. Safe twice (none left after)
update public.tally_check_days set upload_at = null, upload_words = null, lists = 0, gone1 = null, gone1_at = null, done_at = null, tries = 1, next_at = now(), last_why = 'reopened'
 where upload_at is not null and coalesce(upload_words, '') !~* 'month is locked';
update public.tally_period_day_retry r set retry_at = now()
  from public.tally_period_days d where d.book_id = r.book_id and d.day = r.day and d.upload_why = 'slow3' and d.upload_at is not null;
update public.tally_period_days set upload_at = null, upload_why = null, upload_type = null, upload_words = null where upload_why = 'slow3' and upload_at is not null;
-- every other period day's kept words that ask for an upload: said plainly (a locked month's: read again once unlocked,
-- tally_autoday_queue_of)
update public.tally_period_days set upload_words = 'FinCom did not bring in ' || to_char(day, 'DD-Mon-YYYY') || ': its month is locked in FinCom. Unlock the month; FinCom then reads this day by itself.'
 where upload_at is not null and upload_why = 'locked' and coalesce(upload_words, '') ~* 'upload';
update public.tally_period_days set upload_words = 'FinCom could not read ' || to_char(day, 'DD-Mon-YYYY') || ' from Tally by itself.'
 where upload_at is not null and coalesce(upload_why, '') <> 'locked' and coalesce(upload_words, '') ~* 'upload';

-- ---------------------------------------------------------------- 2. helpers (granted to nobody)
-- B.5: after a 2 s stop the day waits 1 h, then 3 h, then 24 h, and every 24 h after
create or replace function public.tally_autoday_backoff(p_tries integer) returns interval
language sql immutable security definer set search_path = public, pg_temp as $function$
  select case when coalesce(p_tries, 1) <= 1 then interval '1 hour' when p_tries = 2 then interval '3 hours' else interval '24 hours' end
$function$;
comment on function public.tally_autoday_backoff(integer) is 'tally autoday (migration 222)';

-- B.1: a day's place in the hand-out by why it was queued (lower first)
create or replace function public.tally_autoday_prio(p_source text) returns smallint
language sql immutable security definer set search_path = public, pg_temp as $function$
  select (case p_source when 'held' then 1 when 'delete' then 2 when 'gap' then 3 when 'future' then 4 else 5 end)::smallint
$function$;
comment on function public.tally_autoday_prio(text) is 'tally autoday (migration 222)';

-- the financial year of a day, as people say it: 2025-26
create or replace function public.tally_autoday_fy(p_day date) returns text
language sql immutable security definer set search_path = public, pg_temp as $function$
  select y::text || '-' || lpad(((y + 1) % 100)::text, 2, '0') from (select (extract(year from p_day) - case when extract(month from p_day) < 4 then 1 else 0 end)::int as y) z
$function$;
comment on function public.tally_autoday_fy(date) is 'tally autoday (migration 222)';

-- the status words kept from before (a bridge's stop, a day given up to an upload): never an ask to upload the Day Book
create or replace function public.tally_autoday_words(p_words text, p_day date) returns text
language sql immutable security definer set search_path = public, pg_temp as $function$
  select case when p_words is null then null
    when p_words ~* 'month is locked' then coalesce(to_char(p_day, 'DD-Mon-YYYY') || ': its', 'Its') || ' month is locked in FinCom. Unlock it, and FinCom reads the day again.'
    when p_words ~* 'upload' then case when p_day is null then 'Tally was slow. FinCom tries it again by itself.' else 'Tally was slow for ' || to_char(p_day, 'DD-Mon-YYYY') || '. FinCom tries it again by itself.' end
    else p_words end
$function$;
comment on function public.tally_autoday_words(text, date) is 'tally autoday (migration 222)';

-- B.6: an entry FinCom posted whose posting is not settled, or settled under 10 minutes ago (by its FinCom id, or the GUID
-- the posting was matched to): never soft-deleted from a list; it waits for the next list
create or replace function public.tally_autoday_fresh_post(p_book uuid, p_guid text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $function$
  select exists (
    select 1 from tally_vouchers v
      join tally_post_ids i on i.firm_id = v.firm_id and ((v.fincom_id is not null and i.fincom_id = v.fincom_id) or lower(coalesce(i.matched_guid, '')) = lower(v.guid))
      join tally_post_jobs j on j.id = i.job_id
     where v.book_id = p_book and v.guid = p_guid
       and (j.status not in ('done', 'failed', 'cancelled')
            or coalesce(j.updated_at, j.taken_at, j.created_at, now()) > now() - interval '10 minutes'
            or greatest(i.accepted_at, i.matched_at) > now() - interval '10 minutes'))
$function$;
comment on function public.tally_autoday_fresh_post(uuid, text) is 'tally autoday (migration 222)';

-- B.6: a day read in MasterID bands is whole only when the bands [[from, to], ...] start at 1, each next one starts right
-- after the one before (no hole, no overlap), the last is open-ended (to null), and every head's MasterID is in a band
create or replace function public.tally_autoday_bands_whole(p_bands jsonb, p_heads jsonb) returns boolean
language sql immutable security definer set search_path = public, pg_temp as $function$
  with b as (
    select case when coalesce(x ->> 0, '') ~ '^[0-9]{1,18}$' then (x ->> 0)::numeric end as a,
           case when x -> 1 is null or jsonb_typeof(x -> 1) = 'null' then null when coalesce(x ->> 1, '') ~ '^[0-9]{1,18}$' then (x ->> 1)::numeric else -1 end as z,
           (jsonb_typeof(x) = 'array' and jsonb_array_length(x) between 1 and 2) as shape
      from jsonb_array_elements(case when jsonb_typeof(p_bands) = 'array' then p_bands else '[]'::jsonb end) x),
  s as (select a, z, lag(z) over (order by a) as pz, row_number() over (order by a) as rn, count(*) over () as n from b)
  select jsonb_typeof(p_bands) = 'array' and jsonb_array_length(p_bands) between 1 and 2000
     and not exists (select 1 from b where not shape or a is null or z = -1)
     and not exists (select 1 from s where (rn = 1 and a <> 1) or (rn > 1 and (pz is null or a <> pz + 1)) or (z is not null and z < a) or (rn = n and z is not null))
     and jsonb_typeof(p_heads) = 'array'
     and not exists (select 1 from jsonb_array_elements(p_heads) h
                      where not (jsonb_typeof(h) = 'array' and coalesce(h ->> 1, '') ~ '^[0-9]{1,18}$'
                                 and exists (select 1 from b where (h ->> 1)::numeric >= b.a and (b.z is null or (h ->> 1)::numeric <= b.z))))
$function$;
comment on function public.tally_autoday_bands_whole(jsonb, jsonb) is 'tally autoday (migration 222)';

-- one day queued for a book (or its place raised): a day open already only takes the lower prio; a day closed is opened
-- again when it was last listed (or given up) before p_since. 1 when queued or opened again. A day given up for a locked
-- month is never opened here (tally_autoday_queue_of opens it once the month is unlocked)
create or replace function public.tally_autoday_put(p_book uuid, p_firm uuid, p_day date, p_source text, p_prio integer, p_since timestamptz) returns integer
language plpgsql security definer set search_path = public, pg_temp as $function$
declare n int := 0;
begin
  update tally_check_days set prio = least(prio, p_prio) where book_id = p_book and day = p_day and done_at is null and upload_at is null and prio > p_prio;
  insert into tally_check_days (book_id, firm_id, day, source, queued_at, prio)
  values (p_book, p_firm, p_day, left(p_source, 20), now(), p_prio)
  on conflict (book_id, day) do update set source = excluded.source, prio = excluded.prio, queued_at = now(), asked_at = null, first_asked_at = null, lists = 0, tally_n = null,
    heads = null, via = null, listed_at = null, gone1 = null, gone1_at = null, added = 0, updated = 0, removed = 0, same = null, done_at = null, upload_at = null, upload_words = null,
    tries = 0, next_at = null, last_why = null, parked_at = null
    where not (tally_check_days.done_at is null and tally_check_days.upload_at is null)
      and coalesce(tally_check_days.upload_words, '') !~* 'month is locked'
      and coalesce(greatest(tally_check_days.listed_at, tally_check_days.upload_at), '-infinity') < coalesce(p_since, 'infinity');
  get diagnostics n = row_count;
  return n;
end $function$;
comment on function public.tally_autoday_put(uuid, uuid, date, text, integer, timestamptz) is 'tally autoday (migration 222)';

-- ---------------------------------------------------------------- 3. the queue (B.1, B.2)
create or replace function public.tally_autoday_queue_of(p_book uuid) returns integer
language plpgsql security definer set search_path = public, pg_temp as $function$
declare b tally_books%rowtype; l tally_links%rowtype; f uuid; today date := (now() at time zone 'Asia/Kolkata')::date; n int := 0; rw record; eb uuid;
  rn tally_check_runs%rowtype; p tally_period_pulls%rowtype; quiet boolean := false; c tally_check_days%rowtype;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('tally_autoday:' || p_book::text, 0)) then return 0; end if;     -- one run a book at a time
  select * into b from tally_books where book_id = p_book;
  if not found then return 0; end if;
  f := b.firm_id;
  select * into l from tally_links lk where lk.book_id = p_book and lk.firm_id = f and lk.state = 'linked' order by lk.linked_at desc nulls last limit 1;
  -- (5) a book no longer linked: its days parked (not counted, not handed; the book's sentence says "Link <co>")
  if not found then
    update tally_check_days set parked_at = now() where book_id = p_book and parked_at is null and done_at is null and upload_at is null;
    return 0;
  end if;
  update tally_check_days set parked_at = null where book_id = p_book and parked_at is not null;          -- linked again

  -- B.8: lines dated before the book's first day: read into the client's book of that year (the latest that begins on or
  -- before the day), or, with none, closed 'stale' with words, never retried
  if b.from_date is not null then
    for rw in select r.vch_date as day, max(r.received_at) as mx from tally_recorder_lines r
              where r.book_id = p_book and r.state in ('held', 'fetching') and r.vch_date < b.from_date and r.vch_date >= date '2000-04-01'
              group by r.vch_date order by r.vch_date desc limit 400 loop
      -- the client's book of that year, only when it is linked (else it could never be read: closed as no year kept)
      select k2.book_id into eb from tally_books k2 where k2.firm_id = f and k2.client_id = b.client_id and k2.book_id <> p_book and k2.from_date is not null and k2.from_date <= rw.day
         and exists (select 1 from tally_links x2 where x2.book_id = k2.book_id and x2.firm_id = f and x2.state = 'linked')
       order by k2.from_date desc limit 1;
      if eb is null then
        update tally_recorder_lines set state = 'stale', held_why = left(format('Made in Tally in %s, a year FinCom does not keep.', tally_autoday_fy(rw.day)), 600)
         where book_id = p_book and vch_date = rw.day and state in ('held', 'fetching');
      else
        select * into c from tally_check_days where book_id = eb and day = rw.day;
        if c.book_id is not null and c.done_at is not null and c.listed_at > rw.mx then
          update tally_recorder_lines set state = 'stale', held_why = left(format('Read into the %s book from Tally.', tally_autoday_fy(rw.day)), 600)
           where book_id = p_book and vch_date = rw.day and state in ('held', 'fetching') and received_at <= rw.mx;
        else
          n := n + tally_autoday_put(eb, f, rw.day, 'held', 1, rw.mx);
        end if;
      end if;
    end loop;
    -- the book's own days before its first day: closed (never read into this book, never counted as waiting)
    update tally_check_days set done_at = now(), last_why = 'before_book' where book_id = p_book and day < b.from_date and done_at is null and upload_at is null;
  end if;

  -- (3) a line dated after the day it came: its day queued on its own date (India's), not before
  for rw in select r.vch_date as day, max(r.received_at) as mx from tally_recorder_lines r
            where r.book_id = p_book and r.state in ('held', 'fetching') and r.vch_date <= today and r.vch_date > (r.received_at at time zone 'Asia/Kolkata')::date
              and (b.from_date is null or r.vch_date >= b.from_date)
            group by r.vch_date order by r.vch_date desc limit 100 loop
    n := n + tally_autoday_put(p_book, f, rw.day, 'future', 4, rw.mx);
  end loop;
  -- (1) the held lines' days (196's rule), prio 1; never a day before the book's first day (B.8 above)
  n := n + coalesce(tally_held_queue_of(p_book, (select array_agg(distinct r.vch_date) from tally_recorder_lines r
                                                  where r.book_id = p_book and r.state in ('held', 'fetching') and r.vch_date is not null
                                                    and (b.from_date is null or r.vch_date >= b.from_date))), 0);
  -- the days held_queue_of opened again (here, or by the lines' own trigger before) start afresh: never handed since,
  -- so no tries and no wait carried over from an earlier read
  update tally_check_days set tries = 0, next_at = null, last_why = null, empty_lists = 0
   where book_id = p_book and source = 'held' and asked_at is null and listed_at is null and lists = 0 and done_at is null and upload_at is null
     and (tries > 0 or next_at is not null or last_why is not null);
  update tally_check_days set prio = 1 where book_id = p_book and source = 'held' and prio > 1 and done_at is null and upload_at is null;
  update tally_check_days set prio = 3 where book_id = p_book and source = 'gap' and prio > 3 and done_at is null and upload_at is null;
  -- (2) possible deletes, prio 2: (a) a delete or cancel line with no GUID; (b) the day's first whole list lacked an entry
  -- FinCom holds and the second has not come
  for rw in select r.vch_date as day, max(r.received_at) as mx from tally_recorder_lines r
            where r.book_id = p_book and r.state in ('held', 'fetching') and r.event in ('deleted', 'cancelled') and r.object_guid is null
              and r.vch_date <= today and (b.from_date is null or r.vch_date >= b.from_date)
            group by r.vch_date order by r.vch_date desc limit 100 loop
    n := n + tally_autoday_put(p_book, f, rw.day, 'delete', 2, rw.mx);
  end loop;
  update tally_check_days set prio = 2 where book_id = p_book and gone1 is not null and prio > 2 and done_at is null and upload_at is null;
  -- (c) a book read on the AlterID path only (its computer set so, or the add-on silent): every day with an entry created or
  -- altered in the last 7 days, once a day (not listed in the last 20 hours), at most 31 dates a book, the latest edits first
  -- (the owner's YES of 24-Nov-2026)
  quiet := exists (select 1 from tally_devices d where d.id = l.device_id and d.recorder_source = 'alterid')
           or (to_regprocedure('public.tally_tell_of(uuid)') is not null and tally_tell_of(p_book) -> 'changes' ->> 'code' = 'addon_silent');
  if quiet then
    for rw in select v.day from tally_voucher_versions w join tally_vouchers v on v.book_id = w.book_id and v.guid = w.tally_guid
              where w.book_id = p_book and w.seen_at > now() - interval '7 days' and v.day <= today and (b.from_date is null or v.day >= b.from_date)
              group by v.day order by max(w.seen_at) desc, v.day desc limit 31 loop
      n := n + tally_autoday_put(p_book, f, rw.day, 'delete', 2, now() - interval '20 hours');
    end loop;
  end if;
  -- a day given up for a locked month: opened again once the month is unlocked
  for rw in select d.day from tally_check_days d where d.book_id = p_book and d.upload_at is not null and coalesce(d.upload_words, '') ~* 'month is locked' and d.upload_at > now() - interval '400 days' loop
    if tally_month_locked(p_book, array[rw.day]) is null then
      update tally_check_days set queued_at = now(), asked_at = null, lists = 0, tally_n = null, heads = null, via = null, listed_at = null, gone1 = null, gone1_at = null,
             done_at = null, upload_at = null, upload_words = null, tries = 0, next_at = null, last_why = null
       where book_id = p_book and day = rw.day;
      n := n + 1;
    end if;
  end loop;

  -- the period's days given up for another reason (a slow or odd day, entries FinCom could not take, payroll): read again
  -- as a check day, under its backoff (6 lists unfinished: 1 h, 3 h, then 24 h); the period day unmarked once that day
  -- is read whole. A payroll day keeps backing off to 24 h until payroll vouchers can be read
  for rw in select d.day, d.upload_at from tally_period_days d
             where d.book_id = p_book and d.upload_at is not null and d.upload_why in ('over2s', 'dates', 'shape', 'toomany', 'entries', 'payroll', 'other')
               and d.day <= today and (b.from_date is null or d.day >= b.from_date)
             order by d.day desc limit 100 loop
    select * into c from tally_check_days where book_id = p_book and day = rw.day;
    if c.book_id is not null and c.done_at is not null and c.done_at > rw.upload_at then
      update tally_period_days set upload_at = null, upload_why = null, upload_type = null, upload_words = null where book_id = p_book and day = rw.day;
    else
      n := n + tally_autoday_put(p_book, f, rw.day, 'check', 5, rw.upload_at);
    end if;
  end loop;
  -- the period's days given up for a locked month: read again once the month is unlocked (as its words promise)
  for rw in select d.day from tally_period_days d where d.book_id = p_book and d.upload_at is not null and d.upload_why = 'locked' loop
    if tally_month_locked(p_book, array[rw.day]) is null then
      update tally_period_days set upload_at = null, upload_why = null, upload_type = null, upload_words = null where book_id = p_book and day = rw.day;
    end if;
  end loop;

  -- (4) the check going (a bridge's stop retried: B.5; a person's Stop kept), and the period started by itself
  insert into tally_check_runs (book_id, firm_id) values (p_book, f) on conflict (book_id) do nothing;
  select * into rn from tally_check_runs where book_id = p_book;
  if rn.state = 'stopped' and rn.stop_why is distinct from 'person' then
    update tally_check_runs set state = 'going', chosen_at = now(), stopped_at = null, stop_day = null, stop_why = null, stop_words = null where book_id = p_book;
    update tally_check_days set tries = tries + 1, last_why = left(coalesce(last_why, rn.stop_why, 'stopped'), 40), next_at = coalesce(rn.stopped_at, now()) + tally_autoday_backoff(tries + 1)
     where book_id = p_book and day = rn.stop_day and done_at is null and upload_at is null and next_at is null;
  end if;
  select * into p from tally_period_pulls where book_id = p_book;
  if not found then
    insert into tally_period_pulls (book_id, firm_id, fy_start, part, state, chosen_at)
    values (p_book, f, make_date((extract(year from coalesce(b.from_date, today)) - case when extract(month from coalesce(b.from_date, today)) < 4 then 1 else 0 end)::int, 4, 1),
            'year', 'going', coalesce(l.linked_at, now()))
    on conflict (book_id) do nothing;
  elsif p.state = 'going' and p.auto_tries > 0 and exists (select 1 from tally_period_days pdd where pdd.book_id = p_book and pdd.counted_at > p.chosen_at) then
    update tally_period_pulls set auto_tries = 0 where book_id = p_book;          -- it reads again: the next stop waits an hour again
  elsif p.state = 'stopped' and p.stop_why is distinct from 'person' and coalesce(p.stopped_at, '-infinity') <= now() - tally_autoday_backoff(p.auto_tries + 1) then
    update tally_period_pulls set state = 'going', chosen_at = now(), stopped_at = null, stop_day = null, stop_why = null, stop_words = null, auto_tries = auto_tries + 1
     where book_id = p_book and state = 'stopped';
  end if;
  return n;
end $function$;
comment on function public.tally_autoday_queue_of(uuid) is 'tally autoday (migration 222)';

-- tally-ingest's call (the beat, once a book per 10 minutes)
create or replace function public.tally_autoday_queue(p_book uuid) returns integer
language plpgsql security definer set search_path = public, pg_temp as $function$
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  return tally_autoday_queue_of(p_book);
end $function$;
comment on function public.tally_autoday_queue(uuid) is 'tally autoday (migration 222)';

-- the sweep: every book linked, or with days open or parked, or lines being fetched; each in its own block; 5 s a run
-- (one transaction: the books not reached go first next time, in random order)
create or replace function public.tally_autoday_sweep() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $function$
declare t0 timestamptz := clock_timestamp(); bk uuid; nb int := 0; nd int := 0; bad int := 0; left_n int := 0;
begin
  for bk in select b.book_id from tally_books b
             where exists (select 1 from tally_links x where x.book_id = b.book_id and x.firm_id = b.firm_id and x.state = 'linked')
                or exists (select 1 from tally_check_days x where x.book_id = b.book_id and x.done_at is null and x.upload_at is null)
                or exists (select 1 from tally_recorder_lines r where r.book_id = b.book_id and r.state in ('held', 'fetching'))
             order by random() loop
    if clock_timestamp() - t0 > interval '5 seconds' then left_n := left_n + 1; continue; end if;
    begin
      nd := nd + tally_autoday_queue_of(bk); nb := nb + 1;
    exception when others then
      bad := bad + 1; raise log 'tally_autoday_sweep: book %: % %', bk, sqlstate, sqlerrm;
    end;
  end loop;
  return jsonb_build_object('ok', true, 'books', nb, 'queued', nd)
         || case when bad > 0 then jsonb_build_object('booksFailed', bad) else '{}'::jsonb end
         || case when left_n > 0 then jsonb_build_object('left', left_n) else '{}'::jsonb end;
end $function$;
comment on function public.tally_autoday_sweep() is 'tally autoday (migration 222)';

-- a bridge's pickup word for a day it was handed ("started", or the refusal's code): kept as last_why; a 2 s stop holds
-- the day back 1 h, then 3 h, then 24 h; any other refusal (Tally closed, typing, posting, ...) hands it again next beat
create or replace function public.tally_autoday_pickup(p_book uuid, p_day date, p_code text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $function$
declare c text := coalesce(nullif(btrim(coalesce(p_code, '')), ''), 'other'); slow boolean; d tally_check_days%rowtype;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  if c !~ '^[A-Za-z0-9_]{1,40}$' then c := 'other'; end if;
  slow := c in ('slow', 'dayRetry', 'over2s', 'window', 'stopped');
  update tally_check_days set last_why = case when c = 'started' then null else c end,
         tries = tries + case when slow then 1 else 0 end,
         next_at = case when slow then now() + tally_autoday_backoff(tries + 1) else next_at end
   where book_id = p_book and day = p_day and done_at is null and upload_at is null
  returning * into d;
  return jsonb_build_object('ok', true, 'mine', d.book_id is not null, 'tries', d.tries, 'retryAt', d.next_at);
end $function$;
comment on function public.tally_autoday_pickup(uuid, date, text) is 'tally autoday (migration 222)';

-- ---------------------------------------------------------------- 4. the hand-out, the stop (182's texts, lines marked 222)
create or replace function public.tally_check_next_open(p_book uuid, p_max integer, p_auto boolean) returns jsonb     -- 222: p_auto false (a bridge before 2.5.16): only upload, check, fill
language plpgsql security definer set search_path = public, pg_temp as $function$
declare r tally_check_runs%rowtype; p tally_period_pulls%rowtype; has_p boolean; ca timestamptz; out jsonb := '[]'::jsonb; d date; lim int := least(greatest(coalesce(p_max, 3), 0), 30);
  today date := (now() at time zone 'Asia/Kolkata')::date; ra timestamptz; n int := 0;
  d0 date := (select b.from_date from tally_books b where b.book_id = p_book);     -- 222: the book's first day (B.8: never a day before it)
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into r from tally_check_runs where book_id = p_book;
  if not found or (r.state <> 'going' and r.stop_why = 'person') or lim = 0 then return out; end if;     -- 222: only a person's Stop stops the check (B.5)
  select * into p from tally_period_pulls where book_id = p_book;
  has_p := found;
  if has_p and p.state = 'paused' then return out; end if;
  if has_p and p.state = 'stopped' and p.stop_why = 'person' and not (r.chosen_at > coalesce(p.stopped_at, p.chosen_at)) then return out; end if;     -- 222: a bridge's stop is retried (B.5)
  ca := case when has_p and p.state = 'going' then p.chosen_at else r.chosen_at end;
  -- 182: a check the gap's retry resumed (tally_check_paced): its days queued before the resume on the idle pace, one at a
  -- time (tally_light_may / _took), after the days queued since; the person's Resume (a new choice time) ends it
  ra := tally_check_paced(p_book);
  for d in select x.day from tally_check_days x where x.book_id = p_book and x.done_at is null and x.upload_at is null and x.day <= today
              and (ra is null or x.queued_at > ra)
              and x.parked_at is null and (x.next_at is null or x.next_at <= now()) and (d0 is null or x.day >= d0)     -- 222: not parked, not held back, not before the book
              and (coalesce(p_auto, true) or x.source in ('upload', 'check', 'fill'))     -- 222: FinCom's own days only to a bridge that reads them
            order by least(x.prio, tally_autoday_prio(x.source)), (x.asked_at is not null and x.asked_at > now() - interval '2 minutes'), x.day desc limit lim loop     -- 222: prio first
    out := out || jsonb_build_array(jsonb_build_object('day', to_char(d, 'YYYYMMDD'), 'fetch', true, 'chosenAt', ca, 'check', true));
    n := n + 1;
  end loop;
  if ra is not null and n < lim then
    perform 1 from tally_light_pace where book_id = p_book for update;
    if tally_light_may(p_book) then
      for d in select x.day from tally_check_days x where x.book_id = p_book and x.done_at is null and x.upload_at is null and x.day <= today and x.queued_at <= ra
                  and x.parked_at is null and (x.next_at is null or x.next_at <= now()) and (d0 is null or x.day >= d0) and (coalesce(p_auto, true) or x.source in ('upload', 'check', 'fill'))     -- 222
                order by least(x.prio, tally_autoday_prio(x.source)), (x.asked_at is not null and x.asked_at > now() - interval '2 minutes'), x.day desc limit 1 loop     -- 222
        out := out || jsonb_build_array(jsonb_build_object('day', to_char(d, 'YYYYMMDD'), 'fetch', true, 'chosenAt', ca, 'check', true));
        perform tally_light_took(p_book, d, 'check');
      end loop;
    end if;
  end if;
  update tally_check_days x set asked_at = now(), first_asked_at = coalesce(x.first_asked_at, now())
   where x.book_id = p_book and x.day in (select to_date(e->>'day', 'YYYYMMDD') from jsonb_array_elements(out) e);
  return out;
end $function$;
comment on function public.tally_check_next_open(uuid, integer, boolean) is 'tally autoday (migration 222)';

-- the 2-argument call as before: every source (p_auto true)
create or replace function public.tally_check_next_open(p_book uuid, p_max integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $function$
begin
  return tally_check_next_open(p_book, p_max, true);
end $function$;
comment on function public.tally_check_next_open(uuid, integer) is 'tally autoday (migration 222)';

-- the claim (146's text, lines marked 222): p_auto false, for a bridge before 2.5.16, never claims FinCom's own days (held,
-- delete, gap, future), so they are never held from a bridge that reads them. The 7-argument call as before (p_auto true).
-- (No default on p_auto: with one, a 7-argument call would match both and fail as not unique.)
create or replace function public.tally_days_claim(p_firm uuid, p_book uuid, p_device uuid, p_bridge text, p_kind text, p_max integer, p_night boolean, p_auto boolean)     -- 222: p_auto
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare lim int := least(greatest(coalesce(p_max, 3), 0), 30); others int; got jsonb; e jsonb; mine text[] := '{}'; want text[] := '{}'; ok text[]; out jsonb := '[]'::jsonb;
  snap jsonb; back text[] := '{}';
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  if lim = 0 or p_kind not in ('period', 'check') or not tally_read_serves(p_firm, p_book, p_device, p_bridge) then return out; end if;
  perform pg_advisory_xact_lock(hashtext('tally_days_claim:' || p_book::text || ':' || p_kind));
  select count(*)::int into others from tally_work_claims c where c.book_id = p_book and c.kind = p_kind and c.until > now()
     and not (c.device_id = p_device and c.bridge_id = p_bridge);
  -- the asked stamps of the book's days as they are now: a day the call below lists but this bridge is not given gets its
  -- own stamps back (never marked asked for a bridge that never got it)
  if p_kind = 'period' then
    select coalesce(jsonb_object_agg(to_char(x.day, 'YYYYMMDD'), jsonb_build_array(x.asked_at, x.first_asked_at)), '{}'::jsonb) into snap from tally_period_days x where x.book_id = p_book;
  else
    select coalesce(jsonb_object_agg(to_char(x.day, 'YYYYMMDD'), jsonb_build_array(x.asked_at, x.first_asked_at)), '{}'::jsonb) into snap from tally_check_days x where x.book_id = p_book;
  end if;
  got := case when p_kind = 'period' then tally_period_next_paced(p_book, least(30, lim + others), p_night) else tally_check_next_open(p_book, least(30, lim + others), p_auto) end;     -- 222: p_auto
  for e in select x from jsonb_array_elements(coalesce(got, '[]'::jsonb)) x loop
    if coalesce(e ->> 'day', '') !~ '^\d{8}$' then continue; end if;
    if exists (select 1 from tally_work_claims c where c.book_id = p_book and c.kind = p_kind and c.unit = e ->> 'day' and c.until > now()
                 and not (c.device_id = p_device and c.bridge_id = p_bridge)) then continue; end if;
    if cardinality(want) >= lim then exit; end if;
    want := want || (e ->> 'day');
  end loop;
  ok := tally_work_claim(p_firm, p_book, p_kind, want, p_device, p_bridge, 300);
  for e in select x from jsonb_array_elements(coalesce(got, '[]'::jsonb)) x loop
    if (e ->> 'day') = any(ok) and not ((e ->> 'day') = any(mine)) then out := out || jsonb_build_array(e); mine := mine || (e ->> 'day');
    elsif coalesce(e ->> 'day', '') ~ '^\d{8}$' and not ((e ->> 'day') = any(mine)) then back := back || (e ->> 'day'); end if;
  end loop;
  if cardinality(back) > 0 then
    if p_kind = 'period' then
      update tally_period_days x set asked_at = (snap -> to_char(x.day, 'YYYYMMDD') ->> 0)::timestamptz, first_asked_at = (snap -> to_char(x.day, 'YYYYMMDD') ->> 1)::timestamptz
       where x.book_id = p_book and to_char(x.day, 'YYYYMMDD') = any(back);
    else
      update tally_check_days x set asked_at = (snap -> to_char(x.day, 'YYYYMMDD') ->> 0)::timestamptz, first_asked_at = (snap -> to_char(x.day, 'YYYYMMDD') ->> 1)::timestamptz
       where x.book_id = p_book and to_char(x.day, 'YYYYMMDD') = any(back);
    end if;
  end if;
  return out;
end $function$;
comment on function public.tally_days_claim(uuid, uuid, uuid, text, text, integer, boolean, boolean) is 'tally autoday (migration 222)';

create or replace function public.tally_days_claim(p_firm uuid, p_book uuid, p_device uuid, p_bridge text, p_kind text, p_max integer, p_night boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
begin
  return tally_days_claim(p_firm, p_book, p_device, p_bridge, p_kind, p_max, p_night, true);
end $function$;
comment on function public.tally_days_claim(uuid, uuid, uuid, text, text, integer, boolean) is 'tally autoday (migration 222)';

create or replace function public.tally_check_stop(p_book uuid, p_day date, p_why text, p_words text, p_chosen_at timestamptz) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $function$
declare r tally_check_runs%rowtype; p tally_period_pulls%rowtype; hr boolean; hp boolean; w text := left(coalesce(nullif(p_words, ''), 'FinCom stopped reading from Tally: Tally was busy.'), 300);
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  -- 182 (B): the bridge stopped a gap read retried at a quiet time (its own choice time): that retry stops, nothing else
  -- (the check, the period), until the retry has resumed the check; the next idle time tries again
  if p_chosen_at is not null and exists (select 1 from tally_gap_retries g where g.book_id = p_book and g.chosen_at = p_chosen_at and g.resumed_at is null) then
    update tally_gap_retries set stopped_at = now(), stop_day = p_day, stop_why = left(coalesce(p_why, ''), 40) where book_id = p_book and chosen_at = p_chosen_at;
    return jsonb_build_object('ok', true, 'stopped', true, 'retry', true);
  end if;
  -- a check the retry resumed, stopped again: the check stops as below (Resume shown), and the retry with it
  update tally_gap_retries set stopped_at = now(), stop_day = p_day, stop_why = left(coalesce(p_why, ''), 40)
   where book_id = p_book and p_chosen_at is not null and chosen_at = p_chosen_at and resumed_at is not null;
  select * into r from tally_check_runs where book_id = p_book; hr := found;
  select * into p from tally_period_pulls where book_id = p_book; hp := found;
  if p_chosen_at is null or not ((hr and r.chosen_at = p_chosen_at) or (hp and p.chosen_at = p_chosen_at)) then
    return jsonb_build_object('ok', true, 'stopped', false);
  end if;
  -- 222 (B.5): a bridge's stop no longer stops the check for good: the day waits 1 h, then 3 h, then 24 h (and every 24 h
  -- after), its tries and why kept; the check stays going (only a person's Stop stops it); no "upload the Day Book"
  update tally_check_days set tries = tries + 1, last_why = left(coalesce(nullif(p_why, ''), 'stopped'), 40), next_at = now() + tally_autoday_backoff(tries + 1)     -- 222
   where book_id = p_book and day = p_day and done_at is null and upload_at is null;     -- 222
  return jsonb_build_object('ok', true, 'stopped', false, 'retry', true, 'retryAt', (select x.next_at from tally_check_days x where x.book_id = p_book and x.day = p_day));     -- 222
end $function$;
comment on function public.tally_check_stop(uuid, date, text, text, timestamptz) is 'tally autoday (migration 222)';

-- ---------------------------------------------------------------- 5. the day's list (133's text, lines marked 222; B.6)
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
        if tally_autoday_fresh_post(p_book, g) then continue; end if;     -- 222: never a FinCom posting not settled, or settled under 10 minutes ago (the next list)
        if exists (select 1 from tally_recorder_lines rl where rl.book_id = p_book and rl.object_guid = g and rl.state in ('held', 'fetching')) then continue; end if;     -- 222: never one with a line still being brought
        if n = 0 and not (d.empty_lists >= 2 and d.gone1_at <= now() - interval '10 minutes') then continue; end if;     -- 222: an empty list: only on a third, 10 minutes after the first
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
         upload_at = case when locked then now() end,     -- 222: an unfinished day is never given up to an upload: it waits and is read again by itself
         upload_words = case when locked then 'FinCom could not correct ' || to_char(p_day, 'DD-Mon-YYYY') || ': its month is locked in FinCom. Unlock the month, and FinCom reads the day again.' end,     -- 222
         tries = tries + case when not done and not locked and lists + 1 >= 6 then 1 else 0 end,     -- 222
         next_at = case when not done and not locked and lists + 1 >= 6 then now() + tally_autoday_backoff(tries + 1) else next_at end,     -- 222
         last_why = case when not done and not locked and lists + 1 >= 6 then 'unfinished' else last_why end,     -- 222
         empty_lists = case when not whole then empty_lists when n = 0 then empty_lists + 1 else 0 end     -- 222
   where book_id = p_book and day = p_day;
  return jsonb_build_object('ok', true, 'mine', true, 'n', n, 'want', w, 'done', done, 'removed', rem);
end $function$;
comment on function public.tally_check_heads(uuid, date, jsonb, text) is 'tally autoday (migration 222)';

-- a heavy day read in MasterID bands (FinComDayHeadsPart; tally-ingest passes via 'bands' and the bands as the bridge read
-- them): the day's whole list only when every band came back and they join with no hole; else taken as a partial list
-- (no delete, the day not closed). Any other via, or no bands: as the 4-argument one (a 'bands' list there is whole, as today)
create or replace function public.tally_check_heads(p_book uuid, p_day date, p_heads jsonb, p_via text, p_bands jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $function$
declare whole boolean;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  if coalesce(p_via, 'day') <> 'bands' or jsonb_typeof(p_bands) is distinct from 'array' then return tally_check_heads(p_book, p_day, p_heads, p_via); end if;     -- no bands: as today
  whole := tally_autoday_bands_whole(p_bands, p_heads);
  return tally_check_heads(p_book, p_day, p_heads, case when whole then 'day' else 'split' end) || jsonb_build_object('bandsWhole', whole);
end $function$;
comment on function public.tally_check_heads(uuid, date, jsonb, text, jsonb) is 'tally autoday (migration 222)';

-- ---------------------------------------------------------------- 6. the daily sweep (196's text, lines marked 222)
create or replace function public.tally_recorder_fetching_sweep(p_max integer default 2000)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare ids bigint[]; bk uuid; nb int := 0; nc int := 0; mx int := least(greatest(coalesce(p_max, 2000), 1), 10000);
begin
  select array_agg(x.id) into ids from (
    select l.id from tally_recorder_lines l left join tally_recorder_tries t on t.line_row = l.id
     where l.state in ('held', 'fetching')
       and ((t.line_row is not null and t.first_at < now() - interval '7 days') or (t.line_row is null and l.received_at < now() - interval '14 days'))
       and (l.vch_date is null     -- 222: a line of no day (a ledger's) as 196; one of a day only once that day was listed by a bridge after the line came
            or exists (select 1 from tally_check_days k where k.book_id = l.book_id and k.day = l.vch_date and k.listed_at > l.received_at and k.via = 'day')     -- 222
            or exists (select 1 from tally_period_days k where k.book_id = l.book_id and k.day = l.vch_date and k.counted_at > l.received_at))     -- 222
       and not exists (select 1 from tally_books b where b.book_id = l.book_id and b.from_date is not null and l.vch_date < b.from_date)     -- 222: before the book's first day: B.8 (tally_autoday_queue)
     order by l.id limit mx) x;
  if ids is null then return jsonb_build_object('ok', true, 'lines', 0, 'books', 0, 'closed', 0); end if;
  for bk in select distinct l.book_id from tally_recorder_lines l where l.id = any (ids) loop
    begin
      perform tally_recorder_held_rerun(bk, 1000);
      nb := nb + 1;
    exception when others then
      raise log 'tally_recorder_fetching_sweep: book %: % %', bk, sqlstate, sqlerrm;
    end;
  end loop;
  update tally_recorder_lines l set state = 'stale',
         held_why = left(format('FinCom could not bring this from Tally in 7 days (%s); closed, nothing in the books changed for it', coalesce(nullif(l.held_why, ''), 'no answer')), 600)
   where l.id = any (ids) and l.state in ('held', 'fetching');
  get diagnostics nc = row_count;
  return jsonb_build_object('ok', true, 'lines', array_length(ids, 1), 'books', nb, 'closed', nc);
end $function$;
comment on function public.tally_recorder_fetching_sweep(integer) is 'tally autoday (migration 222)';

-- ---------------------------------------------------------------- 7. the words (196's and 182's texts, lines marked 222)
create or replace function public.tally_held_status(p_client text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); out jsonb := '[]'::jsonb; b record; h record; c record; run tally_check_runs%rowtype; rn jsonb; ren jsonb; a jsonb; rate numeric; eta int; st text; fo boolean; fany boolean;
  today date := (now() at time zone 'Asia/Kolkata')::date; ad date; ok boolean; fn int;     -- 196
begin
  if f is null then raise exception 'not allowed' using errcode = '42501'; end if;
  select exists (select 1 from tally_devices d where d.firm_id = f and not coalesce(d.revoked, false) and coalesce(d.period_fetch, false)) into fany;
  select exists (select 1 from tally_devices d where d.firm_id = f and not coalesce(d.revoked, false) and coalesce(d.period_fetch, false) and d.last_seen > now() - interval '10 minutes') into fo;
  for b in select k.book_id, k.client_id, k.company from tally_books k where k.firm_id = f and (p_client is null or k.client_id = p_client) order by k.company, k.book_id loop
    select count(*)::int as n, count(*) filter (where l.event in ('deleted', 'cancelled'))::int as dels, count(*) filter (where l.event not in ('deleted', 'cancelled'))::int as ents,
           min(l.vch_date) as d0, max(l.vch_date) as d1, coalesce(jsonb_agg(distinct to_char(l.vch_date, 'YYYYMMDD')), '[]'::jsonb) as days
      into h from tally_recorder_lines l
     where l.book_id = b.book_id and l.state = 'held' and tally_held_line_ours(l.event, l.object_guid, l.vch_date, l.held_why); select count(*)::int into fn from tally_recorder_lines l where l.book_id = b.book_id and l.state = 'fetching' and (exists (select 1 from tally_check_days k where k.book_id = l.book_id and k.day = l.vch_date and k.done_at is null and k.upload_at is null) or exists (select 1 from tally_recorder_probes p where p.line_row = l.id and p.handed < p.round * 5) or (l.event like 'ledger\_%' and l.received_at > now() - interval '7 days') or (l.received_at > now() - interval '7 days' and l.line_id not like '%:resolved' and (coalesce(l.master_id, '') ~ '^[1-9][0-9]{0,9}$' or (l.object_guid is not null and l.object_guid !~ '-0{8}$')) and exists (select 1 from tally_devices d where d.id = l.device_id and d.last_seen > now() - interval '10 minutes')));     -- 196
    select count(*)::int as total, count(*) filter (where d.done_at is not null and d.upload_at is null)::int as done_n,
           count(*) filter (where d.done_at is null and d.upload_at is null)::int as waiting, count(*) filter (where d.upload_at is not null)::int as upload,
           least(30, extract(epoch from now() - min(coalesce(d.first_asked_at, d.asked_at))) / 60) as mins
      into c from tally_check_days d where d.book_id = b.book_id and d.source = 'held' and d.queued_at > now() - interval '2 days';
    rn := tally_held_renumber_of(b.book_id);
    if h.n = 0 and c.total = 0 and jsonb_array_length(rn) = 0 and coalesce(fn, 0) = 0 then continue; end if;     -- 196
    select * into run from tally_check_runs where book_id = b.book_id;
    rate := case when c.mins >= 2 and c.done_n > 0 then c.done_n / c.mins end;
    eta := case when c.waiting > 0 and rate > 0 then greatest(1, round(c.waiting / rate))::int end;
    st := case when run.book_id is not null and run.state = 'stopped' and run.stop_why = 'person' and c.waiting > 0 then 'stopped' when not fo and c.waiting > 0 then 'off'     -- 222: only a person's Stop
               when c.total = 0 then 'none' when c.waiting = 0 then 'done' when c.done_n + c.upload > 0 then 'checking' else 'queued' end;
    ren := '[]'::jsonb;
    for a in select jsonb_array_elements(rn) loop
      ad := least(today, ((a->>'at')::timestamptz at time zone 'Asia/Kolkata')::date);
      select not exists (select 1 from generate_series((a->>'from')::date, ad, interval '1 day') d
                          where not exists (select 1 from tally_check_days x where x.book_id = b.book_id and x.day = d::date and x.done_at is not null and x.via = 'day' and x.listed_at > (a->>'at')::timestamptz)
                            and not exists (select 1 from tally_days t where t.book_id = b.book_id and t.day = d::date and t.at > (a->>'at')::timestamptz)) into ok;
      ren := ren || jsonb_build_array(jsonb_build_object('from', to_char((a->>'from')::date, 'YYYYMMDD'), 'at', a->>'at', 'n', a->'n', 'more', a->'more', 'checked', ok));
    end loop;
    out := out || jsonb_build_array(jsonb_build_object('book', b.book_id, 'client', b.client_id, 'company', b.company,
      'held', h.n, 'deletes', h.dels, 'entries', h.ents, 'from', to_char(h.d0, 'YYYYMMDD'), 'to', to_char(h.d1, 'YYYYMMDD'), 'days', h.days,
      'check', jsonb_build_object('total', c.total, 'done', c.done_n, 'waiting', c.waiting, 'upload', c.upload, 'etaMin', eta, 'state', st,
                                  'words', case when st = 'stopped' then tally_autoday_words(run.stop_words, run.stop_day) end,     -- 222: never asks for an upload
                                  'why', case when st = 'off' then case when fany then 'offline' else 'switch' end end),
      'fetchOn', fo, 'renumber', ren, 'fetching', coalesce(fn, 0)));     -- 196
  end loop;
  return jsonb_build_object('ok', true, 'books', out);
end $function$;
comment on function public.tally_held_status(text) is 'tally autoday (migration 222)';

create or replace function public.tally_check_status_of(p_book uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $function$
declare r tally_check_runs%rowtype; run jsonb; lines jsonb; c record; per text;
begin
  select * into r from tally_check_runs where book_id = p_book;
  run := case when found then jsonb_build_object('state', r.state, 'why', r.stop_why, 'words', tally_autoday_words(r.stop_words, r.stop_day), 'day', to_char(r.stop_day, 'YYYYMMDD'), 'at', r.stopped_at, 'chosenAt', r.chosen_at) end;     -- 222: never asks for an upload
  -- 182: a check the gap's retry resumed, its earlier days read slowly while Tally is idle: said (the page offers Read now)
  if found and tally_check_paced(p_book) is not null then run := run || jsonb_build_object('paced', true); end if;
  select state into per from tally_period_pulls where book_id = p_book;
  select coalesce(jsonb_agg(jsonb_build_object('day', to_char(x.day, 'YYYYMMDD'), 'state', x.st, 'added', x.added, 'updated', x.updated, 'removed', x.removed,
           'words', case x.st when 'upload' then tally_autoday_words(x.upload_words, x.day) when 'waiting' then 'waiting for Tally' when 'same' then 'the same as Tally'     -- 222
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
comment on function public.tally_check_status_of(uuid) is 'tally autoday (migration 222)';

-- a slow day of the period (197's text, lines marked 222): on its 3rd try it no longer asks for the Day Book: it waits
create or replace function public.tally_period_day_stop(p_book uuid, p_day date, p_why text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid; r tally_period_day_retry%rowtype; n int; up boolean := false; w text;
begin
  if not tally_service_or_owner() then raise exception 'not allowed' using errcode = '42501'; end if;
  select firm_id into f from tally_books where book_id = p_book;
  if f is null or p_day is null then return jsonb_build_object('ok', false, 'error', 'no such book or day'); end if;
  insert into tally_period_day_retry (book_id, firm_id, day, fails, first_at, last_at, retry_at, why)
  values (p_book, f, p_day, 0, now(), now() - interval '1 day', now(), left(coalesce(p_why, ''), 40))
  on conflict (book_id, day) do nothing;
  select * into r from tally_period_day_retry where book_id = p_book and day = p_day for update;
  -- 222: each try after the day's wait is over counts; a stop while it still waits is the same try's
  n := case when r.fails = 0 or r.retry_at <= now() then r.fails + 1 else r.fails end;     -- 222
  update tally_period_day_retry set fails = n, last_at = case when n > r.fails then now() else last_at end, retry_at = now() + tally_autoday_backoff(n),     -- 222: 1 h, 3 h, then 24 h
         why = left(coalesce(p_why, ''), 40)
   where book_id = p_book and day = p_day;
  -- 222: never "upload the Day Book": the day waits (1 h, 3 h, then every 24 h) and is read again by itself, said plainly;
  -- its check day (if any) waits the same
  w := 'Tally was slow for ' || to_char(p_day, 'DD-Mon-YYYY') || '. FinCom tries it again by itself.';     -- 222
  update tally_check_days set tries = greatest(tries, n), last_why = left(coalesce(nullif(p_why, ''), 'slow'), 40), next_at = now() + tally_autoday_backoff(n)     -- 222
   where book_id = p_book and day = p_day and done_at is null and upload_at is null;     -- 222
  return jsonb_build_object('ok', true, 'fails', n, 'upload', up, 'retryAt', now() + tally_autoday_backoff(n), 'words', w);     -- 222
end $function$;
comment on function public.tally_period_day_stop(uuid, date, text) is 'tally autoday (migration 222)';

-- the entries of a day being checked (133's text, one line marked 222): the month-locked words never ask for an upload
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
    wl := 'FinCom could not correct ' || to_char(p_day, 'DD-Mon-YYYY') || ': its month is locked in FinCom. Unlock the month, and FinCom reads the day again.';     -- 222
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
comment on function public.tally_check_entries(uuid, date, jsonb, jsonb, jsonb) is 'tally autoday (migration 222)';

-- a period day the bridge cannot read (98's text, one line marked 222): its words never ask for an upload
create or replace function public.tally_period_upload(p_book uuid, p_day date, p_why text, p_type text, p_words text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid;
begin
  if not tally_service_or_owner() then raise exception 'not allowed' using errcode = '42501'; end if;
  select firm_id into f from tally_period_pulls where book_id = p_book;
  if f is null or p_day is null then return jsonb_build_object('ok', false, 'error', 'FinCom did not ask for this day'); end if;
  insert into tally_period_days (book_id, firm_id, day, upload_at, upload_why, upload_type, upload_words)
  values (p_book, f, p_day, now(), left(coalesce(p_why, ''), 40), nullif(left(coalesce(p_type, ''), 100), ''),
          left(case when coalesce(p_words, '') = '' or p_words ~* 'upload' then 'FinCom could not read ' || to_char(p_day, 'DD-Mon-YYYY') || ' from Tally by itself.' else p_words end, 300))     -- 222: never an ask to upload
  on conflict (book_id, day) do update set upload_at = coalesce(tally_period_days.upload_at, now()), upload_why = excluded.upload_why, upload_type = excluded.upload_type, upload_words = excluded.upload_words;
  return jsonb_build_object('ok', true);
end $function$;
comment on function public.tally_period_upload(uuid, date, text, text, text) is 'tally autoday (migration 222)';

-- the period's entries of a day and its hand-out (98's and 182's texts, one line each marked 222): a locked month's
-- words never ask for an upload
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
    w := 'FinCom did not bring in ' || to_char(p_day, 'DD-Mon-YYYY') || ': its month is locked in FinCom. Unlock the month; FinCom then reads this day by itself.';     -- 222
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
comment on function public.tally_period_entries(uuid, date, jsonb, jsonb, jsonb, jsonb) is 'tally autoday (migration 222)';

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
  if n = 0 and rc is not null then perform 1 from tally_light_pace where book_id = p_book for update; end if;
  if n = 0 and rc is not null and tally_light_may(p_book) then
    for d in select x.day from tally_period_days x
              where x.book_id = p_book and x.day between p.fy_start and least(fy_to, today) and x.tally_n is not null and x.upload_at is null
                and coalesce(x.counted_at, '-infinity'::timestamptz) < rc
              order by (x.asked_at is not null and x.asked_at > now() - interval '2 minutes'), x.day desc limit 1 loop
      out := out || jsonb_build_array(jsonb_build_object('day', to_char(d, 'YYYYMMDD'), 'fetch', false, 'chosenAt', p.chosen_at));
      nr := 1;
      perform tally_light_took(p_book, d, 'period');
    end loop;
  end if;
  if n = 0 and not exists (select 1 from generate_series(least(fy_to, today), p.fy_start, interval '-1 day') g
                            where not exists (select 1 from tally_period_days x where x.book_id = p_book and x.day = g::date and (x.tally_n is not null or x.upload_at is not null))) then
    -- the year is counted: the part's days FinCom does not hold whole; a locked month's days marked to upload, not fetched
    update tally_period_days x set upload_at = now(), upload_why = 'locked',
           upload_words = 'FinCom did not bring in ' || to_char(x.day, 'DD-Mon-YYYY') || ': its month is locked in FinCom. Unlock the month; FinCom then reads this day by itself.'     -- 222
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
comment on function public.tally_period_next_paced(uuid, integer, boolean) is 'tally autoday (migration 222)';

-- ---------------------------------------------------------------- 8. grants (explicit)
revoke all on function public.tally_autoday_backoff(integer), public.tally_autoday_prio(text), public.tally_autoday_fy(date), public.tally_autoday_words(text, date),
  public.tally_autoday_fresh_post(uuid, text), public.tally_autoday_bands_whole(jsonb, jsonb), public.tally_autoday_put(uuid, uuid, date, text, integer, timestamptz),
  public.tally_autoday_queue_of(uuid), public.tally_autoday_sweep() from public, anon, authenticated, service_role;
revoke all on function public.tally_autoday_queue(uuid) from public, anon, authenticated;
grant execute on function public.tally_autoday_queue(uuid) to service_role;
revoke all on function public.tally_autoday_pickup(uuid, date, text) from public, anon, authenticated;
grant execute on function public.tally_autoday_pickup(uuid, date, text) to service_role;
revoke all on function public.tally_check_heads(uuid, date, jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function public.tally_check_heads(uuid, date, jsonb, text, jsonb) to service_role;
-- the replaced functions' own grants, restated as their files made them
revoke all on function public.tally_check_next_open(uuid, integer) from public, anon, authenticated;
grant execute on function public.tally_check_next_open(uuid, integer) to service_role;
revoke all on function public.tally_check_next_open(uuid, integer, boolean) from public, anon, authenticated;
grant execute on function public.tally_check_next_open(uuid, integer, boolean) to service_role;
revoke all on function public.tally_days_claim(uuid, uuid, uuid, text, text, integer, boolean) from public, anon, authenticated;
grant execute on function public.tally_days_claim(uuid, uuid, uuid, text, text, integer, boolean) to service_role;
revoke all on function public.tally_days_claim(uuid, uuid, uuid, text, text, integer, boolean, boolean) from public, anon, authenticated;
grant execute on function public.tally_days_claim(uuid, uuid, uuid, text, text, integer, boolean, boolean) to service_role;
revoke all on function public.tally_check_stop(uuid, date, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.tally_check_stop(uuid, date, text, text, timestamptz) to service_role;
revoke all on function public.tally_check_heads(uuid, date, jsonb, text) from public, anon, authenticated;
grant execute on function public.tally_check_heads(uuid, date, jsonb, text) to service_role;
revoke all on function public.tally_recorder_fetching_sweep(integer) from public, anon, authenticated;
grant execute on function public.tally_recorder_fetching_sweep(integer) to service_role;
revoke all on function public.tally_held_status(text) from public, anon;
grant execute on function public.tally_held_status(text) to authenticated, service_role;
revoke all on function public.tally_check_status_of(uuid) from public, anon, authenticated, service_role;
revoke all on function public.tally_period_day_stop(uuid, date, text) from public, anon, authenticated;
grant execute on function public.tally_period_day_stop(uuid, date, text) to service_role;
revoke all on function public.tally_check_entries(uuid, date, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.tally_check_entries(uuid, date, jsonb, jsonb, jsonb) to service_role;
revoke all on function public.tally_period_upload(uuid, date, text, text, text) from public, anon, authenticated;
revoke all on function public.tally_period_entries(uuid, date, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.tally_period_entries(uuid, date, jsonb, jsonb, jsonb, jsonb) to service_role;
revoke all on function public.tally_period_next_paced(uuid, integer, boolean) from public, anon, authenticated;
grant execute on function public.tally_period_next_paced(uuid, integer, boolean) to service_role;
grant execute on function public.tally_period_upload(uuid, date, text, text, text) to service_role;

-- ---------------------------------------------------------------- 9. the jobs (pg_cron where it is there)
do $cron$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise notice 'migration 222: pg_cron is not here: the autoday sweep is not scheduled (call tally_autoday_sweep yourself)';
  else
    perform cron.schedule('tally-autoday', '3-59/15 * * * *', 'select public.tally_autoday_sweep()');           -- every 15 minutes
    perform cron.schedule('tally-autoday-night', '37 18 * * *', 'select public.tally_autoday_sweep()');         -- 18:37 UTC = 00:07 India time: the new day's future lines
  end if;
end $cron$;

commit;
