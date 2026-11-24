-- migration-214-light-days-no-gap.sql (23-Nov-2026, branch next-fix-light-days). Written, NOT run yet: the owner reads it and runs it.
-- Why (staging, 23-Nov-2026): after a posting, 182's trigger queues the posted entries' days as light days (tally_light_days,
-- why 'post'; From Tally's older days as why 'fill') to be read back from Tally. Only tally_gap_front hands them out, and
-- it stopped at once when no gap was open (tally_sync_cursor.gap null). On staging a book with no gap had 155 of its 212
-- light days never handed out, so the entries FinCom posted to Tally never came back into FinCom's copy.
-- What 214 does. tally_gap_front(book, max, idle) only, 182's text with four changes (marked 214):
--   with no gap open (or no cursor row yet), the light days are still handed out: only when idle (p_idle) and paced by
--   182's tally_light_may / tally_light_took (one day at a time, none in the last 25 s, the last one picked up by the
--   bridge or 10 minutes old, 120 an hour, 600 a day, no posting of the company waiting or running), one day a call
--   whatever p_max (as a gap open 6 hours); a check stopped, or older entries paused or stopped, hands out nothing (no
--   retry without a gap: a stopped check waits for the person's Resume); the gap's own days, its 2-minute wait and its
--   wait for held recorder lines are for a gap only. A gap open: as 182, byte for byte in behaviour.
-- Nothing new is asked of Tally (the same whole-day read: 133's check day); the bridge's rules stay (each request at most
-- 2 s, one at a time, postings first, the typing gate). tally_gap_front(book, max) (160's arguments, not idle) unchanged.
-- Add-only: one function replaced with the same arguments and result; grants restated (service_role only, as on staging);
-- a comment marks it as 214's. Stops at the start, changing nothing, when tally_gap_front(uuid, integer, boolean) is not
-- 182's text or 214's, or 182's helpers are missing. One transaction, lock_timeout 10 s; safe twice.
-- Tested by tests/run_migration214.py (pg_stand). Runs after 182.
begin;
set local lock_timeout = '10s';

-- ---------------------------------------------------------------- 0. the name guard
do $names$
declare f regprocedure := to_regprocedure('public.tally_gap_front(uuid, integer, boolean)'); bad text[] := '{}'; h text;
begin
  if f is null then
    bad := bad || 'function tally_gap_front(uuid, integer, boolean) is missing (migration 182 first)'::text;
  elsif coalesce(obj_description(f, 'pg_proc'), '') <> 'tally gap front (migration 214)'
        and (select md5(p.prosrc) from pg_proc p where p.oid = f) <> '1d2b4502e5473d6aa051ac86755a77be' then
    bad := bad || 'function tally_gap_front(uuid, integer, boolean) is not 182''s text'::text;
  end if;
  if f is not null and (select p.prorettype from pg_proc p where p.oid = f) <> 'jsonb'::regtype then
    bad := bad || 'function tally_gap_front(uuid, integer, boolean) does not return jsonb'::text;
  end if;
  foreach h in array array['public.tally_light_may(uuid)', 'public.tally_light_took(uuid, date, text)', 'public.tally_day_read_for(uuid, date, timestamptz)'] loop
    if to_regprocedure(h) is null then bad := bad || ('function ' || h || ' is missing'); end if;
  end loop;
  foreach h in array array['public.tally_light_days', 'public.tally_light_pace', 'public.tally_gap_retries', 'public.tally_check_days', 'public.tally_sync_cursor'] loop
    if to_regclass(h) is null then bad := bad || ('table ' || h || ' is missing'); end if;
  end loop;
  if array_length(bad, 1) > 0 then
    raise exception 'migration 214: %. Nothing was changed.', array_to_string(bad, '; ');
  end if;
end $names$;

-- ---------------------------------------------------------------- 1. the gap read, and the light days with no gap
create or replace function public.tally_gap_front(p_book uuid, p_max integer, p_idle boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $function$
declare c tally_sync_cursor%rowtype; bk tally_books%rowtype; r tally_check_runs%rowtype; p tally_period_pulls%rowtype; t tally_gap_retries%rowtype; n tally_gap_numbers%rowtype;
  has_p boolean; has_r boolean; ca timestamptz; out jsonb := '[]'::jsonb; e record; a date; z date := (now() at time zone 'Asia/Kolkata')::date; since_ timestamptz;
  lim int := least(greatest(coalesce(p_max, 1), 0), 7); idle boolean := coalesce(p_idle, false); retry boolean := false; old boolean; light boolean; fa timestamptz; posting boolean;
  days date[] := '{}'; gaps date[] := '{}'; lights date[] := '{}'; nogap boolean;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_book is null or lim = 0 then return out; end if;
  -- the book's rows written under the lock 135's tally_check_request and tally_fill_request take first (one order for all)
  perform pg_advisory_xact_lock(hashtext('tally_check_request:' || p_book::text));
  -- 182 (the owner's decision of 13-Nov-2026): a retry whose day Tally gave whole (the bridge stops a request over 2 s, so
  -- a day listed is one given in time) and not stopped resumes the check by itself, under the retry's choice time
  select * into t from tally_gap_retries where book_id = p_book;
  if found and t.stopped_at is null and t.resumed_at is null and t.day is not null
     and exists (select 1 from tally_check_days k where k.book_id = p_book and k.day = t.day and k.via is not null and k.listed_at >= t.started_at) then
    update tally_gap_retries set resumed_at = now() where book_id = p_book and stopped_at is null and resumed_at is null and chosen_at = t.chosen_at;
    if found then
      update tally_check_runs set state = 'going', chosen_at = t.chosen_at, stopped_at = null, stop_day = null, stop_why = null, stop_words = null
       where book_id = p_book and state = 'stopped' and coalesce(stop_why, '') in ('over2s', 'window');
    end if;
  end if;
  -- postings first: none while a posting of the book's company waits or runs (touched in the last 30 minutes: one stuck
  -- for hours never holds the reads all day; and the computer is not idle for the light reads);
  -- 182: whether the book's computer is idle now, kept at every beat for every book (98's recount and 135's check of a
  -- resumed check read it), gap or not
  select * into bk from tally_books where book_id = p_book;
  if not found then return out; end if;
  posting := exists (select 1 from tally_post_jobs j where j.firm_id = bk.firm_id and j.company = bk.company and j.status in ('waiting', 'taken', 'running')
                       and j.updated_at > now() - interval '30 minutes');
  insert into tally_light_pace (book_id, firm_id, idle_at) values (p_book, bk.firm_id, case when idle and not posting then now() end)
  on conflict (book_id) do update set idle_at = excluded.idle_at;
  if posting then return out; end if;
  select * into c from tally_sync_cursor where book_id = p_book;
  -- 214: no gap open (or no cursor yet): the light days only (posted days, older days asked by From Tally), idle and paced
  -- as with a gap open 6 hours (one day, tally_light_may, tally_light_took), under the same stops but no retry (a stopped
  -- check waits for the person's Resume); the gap's own days and its wait for held lines are for a gap only
  nogap := not found or c.gap is null or c.gap_at is null;
  if nogap and not idle then return out; end if;
  c.firm_id := coalesce(c.firm_id, bk.firm_id);
  if not nogap then
  if c.gap_at > now() - interval '2 minutes' or coalesce(c.gap->>'since', '') !~ '^\d{4}-\d\d-\d\d' then return out; end if;
  since_ := (c.gap->>'since')::timestamptz;
  a := (since_ at time zone 'Asia/Kolkata')::date;
  -- nothing of the book held or waiting since the gap began (the held lines' own path goes first)
  if exists (select 1 from tally_recorder_lines l where l.book_id = p_book and l.received_at >= since_ and l.state in ('held', 'received')) then return out; end if;
  end if;
  -- 135's stop rules; 182: a 2 s stop an hour old or more is tried again, one light day, at most every 3 hours
  select * into r from tally_check_runs where book_id = p_book;
  has_r := found;
  select * into t from tally_gap_retries where book_id = p_book;
  if has_r and r.state <> 'going' then
    if nogap then return out; end if;
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
  old := nogap or c.gap_at < now() - interval '6 hours';
  perform 1 from tally_light_pace where book_id = p_book for update;
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
  if retry or old or array_length(lights, 1) > 0 then perform tally_light_took(p_book, days[1], 'check'); end if;
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


comment on function public.tally_gap_front(uuid, integer, boolean) is 'tally gap front (migration 214)';
revoke all on function public.tally_gap_front(uuid, integer, boolean) from public, anon, authenticated;
grant execute on function public.tally_gap_front(uuid, integer, boolean) to service_role;

commit;
