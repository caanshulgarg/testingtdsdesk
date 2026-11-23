-- migration-216-gap-older-reading.sql (23-Nov-2026, branch next-fix-false-errors). Written, NOT run yet: the owner reads it and runs it.
-- Why (staging, 23-Nov-2026, a client's TDS page): the bell and the page said "Changes were made in Tally on older dates.
-- Upload the Day Book from 01-Apr-2026 to today." 182's tally_gap_state says so (older) as soon as the gap's own days match
-- Tally. But FinCom reads those older days from Tally by itself: 182's recount (tally_period_next_paced: the year's days
-- counted before Tally's number now was seen are counted again, one light day at a time while the computer is idle, and a
-- day whose count differs is brought in) and From Tally's older days (tally_fill_request: light days, why 'fill', handed out
-- by tally_gap_front while the gap is open). On that book the period was 'going', its computer's switch for older entries
-- on, 234 of the year's 237 days counted before Tally's number was seen and 230 'fill' days queued: the reads were under
-- way, and the person was told to upload a Day Book that FinCom was fetching anyway. Bridge 2.5.20 turns that switch on for
-- every computer, so this is the common case.
-- What 216 does. tally_gap_state(book, gap, gap_at) only: 182's text with one change (marked 216). When the gap's own days
-- match (older), and the check can still read and a computer reads older entries for the company (182's can and reader),
-- and FinCom still has older days to read by itself: (a) the period 'going' with a day of its year not counted since
-- Tally's number now was first seen (and not marked to upload), or (b) a 'fill' light day not read whole since then; the
-- gap says checking (with checkUntil, an hour on, as 182) and keeps older with reading: true. The page shows "Checking with
-- Tally… (no action needed)"; once nothing is left to read (or an hour with no write of the gap: the computer away), the
-- upload is asked as before. Nothing new is asked of Tally; the bridge's rules stay (each request at most 2 s, one at a
-- time, postings first, the typing gate); the reads keep 182's idle pace.
-- Add-only: one function replaced with the same arguments and result; grants restated (service_role only, as 182); a
-- comment marks it as 216's. Stops at the start, changing nothing, when tally_gap_state is not 182's text or 216's, or
-- 182's helpers are missing. One transaction, lock_timeout 10 s; safe twice. Tested by tests/run_migration216.py
-- (pg_stand) and tests/run_gap_older_page.py (the page). Runs after 182 (214 or not).
begin;
set local lock_timeout = '10s';

-- ---------------------------------------------------------------- 0. the name guard
do $names$
declare f regprocedure := to_regprocedure('public.tally_gap_state(uuid, jsonb, timestamptz)'); bad text[] := '{}'; h text;
begin
  if f is null then
    bad := bad || 'function tally_gap_state(uuid, jsonb, timestamptz) is missing (migration 182 first)'::text;
  elsif coalesce(obj_description(f, 'pg_proc'), '') <> 'tally gap state (migration 216)'
        and (select md5(p.prosrc) from pg_proc p where p.oid = f) <> '30ccba4666af31bcb0a958b304e9f249' then
    bad := bad || 'function tally_gap_state(uuid, jsonb, timestamptz) is not 182''s text'::text;
  end if;
  if f is not null and (select p.prorettype from pg_proc p where p.oid = f) <> 'jsonb'::regtype then
    bad := bad || 'function tally_gap_state(uuid, jsonb, timestamptz) does not return jsonb'::text;
  end if;
  foreach h in array array['public.tally_gap_own_read(uuid, jsonb)', 'public.tally_day_read_for(uuid, date, timestamptz)'] loop
    if to_regprocedure(h) is null then bad := bad || ('function ' || h || ' is missing'); end if;
  end loop;
  foreach h in array array['public.tally_light_days', 'public.tally_gap_numbers', 'public.tally_period_pulls', 'public.tally_period_days', 'public.tally_check_runs', 'public.tally_gap_retries'] loop
    if to_regclass(h) is null then bad := bad || ('table ' || h || ' is missing'); end if;
  end loop;
  if array_length(bad, 1) > 0 then
    raise exception 'migration 216: %. Nothing was changed.', array_to_string(bad, '; ');
  end if;
end $names$;

-- ---------------------------------------------------------------- 1. what the gap says
create or replace function public.tally_gap_state(p_book uuid, p_gap jsonb, p_gap_at timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $function$
declare a date; z date := (now() at time zone 'Asia/Kolkata')::date; since_ timestamptz; r tally_check_runs%rowtype; p tally_period_pulls%rowtype; t tally_gap_retries%rowtype;
  bk tally_books%rowtype; n tally_gap_numbers%rowtype; can boolean; reader boolean; own boolean; own_left boolean; post_left boolean; chk boolean; fy date; pd date;
  fy_to date; reading boolean := false; o jsonb;
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
  o := jsonb_build_object('from', to_char(fy, 'YYYY-MM-DD'), 'say', 'Changes were made in Tally on older dates.',
                          'fix', 'Upload the Day Book from ' || to_char(fy, 'DD-Mon-YYYY') || ' to today.');
  -- 216: FinCom still reads older days by itself (the check can read, a computer reads older entries): (a) 182's recount,
  -- the period going with a day of its year not counted since Tally's number now was first seen (nor marked to upload);
  -- (b) From Tally's older days ('fill' light days) not read whole since then. Checking (an hour on, as above), older kept
  if coalesce(can, false) and reader and n.book_id is not null then
    if p.book_id is not null and p.state = 'going' then
      fy_to := (p.fy_start + interval '1 year' - interval '1 day')::date;
      reading := exists (select 1 from generate_series(p.fy_start, least(fy_to, z), interval '1 day') g
                          where not exists (select 1 from tally_period_days x where x.book_id = p_book and x.day = g::date
                                              and (x.upload_at is not null or (x.tally_n is not null and x.counted_at >= n.first_at))));
    end if;
    reading := reading or exists (select 1 from tally_light_days l where l.book_id = p_book and l.why = 'fill' and l.day <= z
                                    and not tally_day_read_for(p_book, l.day, n.first_at)
                                    and not exists (select 1 from tally_check_days k where k.book_id = p_book and k.day = l.day and k.upload_at is not null));
  end if;
  if reading then
    return jsonb_build_object('checking', true, 'checkUntil', now() + interval '1 hour', 'older', o || jsonb_build_object('reading', true));
  end if;
  return jsonb_build_object('checking', false, 'older', o);
end $function$;

comment on function public.tally_gap_state(uuid, jsonb, timestamptz) is 'tally gap state (migration 216)';
revoke all on function public.tally_gap_state(uuid, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.tally_gap_state(uuid, jsonb, timestamptz) to service_role;

commit;
