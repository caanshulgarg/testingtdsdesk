-- Migration 197 (13-Nov-2026, FinCom Bridge 2.5.16; the owner's YES of 13-Nov-2026: "stops lift by themselves"). Runs after
-- 98, 133 and 182. Before: a day Tally was too slow to give (its list or an entry over the 2 s stop, or Tally's window held
-- 2 s) stopped the whole period of the book (tally_period_stop) until the person chose again, and the person was asked to
-- upload the Day Book at once. Now (the bridge 2.5.16 sends period_day_stop instead of period_stop):
--   1. only that day stops; it is not handed out again for 24 hours (tally_period_day_retry.retry_at), the other days go on;
--   2. a try counts once a day (a stop within 20 hours of the last one counted is the same day's try); on the 3rd day that
--      fails the day is marked to upload (tally_period_days upload_why 'slow3', and an open check day of it), with the
--      words "Tally could not send <d-Mon-yyyy> in time on 3 days. Upload that day's Day Book to finish it.";
--   3. tally_period_retry_days: the days of a book held now (tally-ingest leaves them out of the days it hands out);
--   4. tally_catchup_status: for the page's line "Bringing in N missed days from Tally, M left": the days being brought in
--      (period and check days Tally lists entries for that FinCom does not hold whole yet: left), and those brought in
--      today (finished after they were first counted), for one of the firm's own books.
-- Add-only: one new table (row security on, service_role only), four new functions; no existing function, table or row
-- changed except the marks of item 2. One transaction, lock_timeout 10 s, safe twice. Tested by tests/run_migration197.py.
-- Deploy order: 197, then the tally-ingest of the same branch (without 197 that tally-ingest asks the bridge to stop the
-- book's period as before: the bridge falls back to period_stop).
begin;
set local lock_timeout = '10s';

create table if not exists public.tally_period_day_retry (
  book_id  uuid not null references public.tally_books(book_id) on delete cascade,
  firm_id  uuid not null,
  day      date not null,
  fails    integer not null default 0 check (fails between 0 and 1000),   -- separate days the day failed on
  first_at timestamptz not null default now(),
  last_at  timestamptz not null default now(),                           -- the last try counted
  retry_at timestamptz not null default now(),                           -- not handed out before this
  why      text check (why is null or length(why) <= 40),
  primary key (book_id, day)
);
create index if not exists tally_period_day_retry_held on public.tally_period_day_retry (book_id, retry_at);
alter table public.tally_period_day_retry enable row level security;
revoke all on table public.tally_period_day_retry from public, anon, authenticated;
grant select, insert, update, delete on public.tally_period_day_retry to service_role;

-- the bridge's day stop: {ok, fails, upload, retryAt, words}
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
  -- one try a day: a stop within 20 hours of the last one counted is the same day's
  n := case when r.fails = 0 or r.last_at <= now() - interval '20 hours' then r.fails + 1 else r.fails end;
  update tally_period_day_retry set fails = n, last_at = case when n > r.fails then now() else last_at end, retry_at = now() + interval '24 hours',
         why = left(coalesce(p_why, ''), 40)
   where book_id = p_book and day = p_day;
  if n >= 3 then
    up := true;
    w := 'Tally could not send ' || to_char(p_day, 'DD-Mon-YYYY') || ' in time on 3 days. Upload that day''s Day Book to finish it.';
    insert into tally_period_days (book_id, firm_id, day, upload_at, upload_why, upload_words) values (p_book, f, p_day, now(), 'slow3', w)
    on conflict (book_id, day) do update set upload_at = coalesce(tally_period_days.upload_at, now()),
      upload_why = coalesce(tally_period_days.upload_why, 'slow3'), upload_words = coalesce(tally_period_days.upload_words, w);
    update tally_check_days set upload_at = now(), upload_words = w
     where book_id = p_book and day = p_day and done_at is null and upload_at is null;
  end if;
  return jsonb_build_object('ok', true, 'fails', n, 'upload', up, 'retryAt', now() + interval '24 hours', 'words', w);
end $function$;

-- the days of a book held now (yyyymmdd), at most 400
create or replace function public.tally_period_retry_days(p_book uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $function$
  select case when tally_service_or_owner() then coalesce((select jsonb_agg(to_char(d.day, 'YYYYMMDD') order by d.day desc)
    from (select day from tally_period_day_retry where book_id = p_book and retry_at > now() order by day desc limit 400) d), '[]'::jsonb) end
$function$;

-- the catch-up's count for a book: {ok, n, left, held} (held: days waiting for their 24 hours)
create or replace function public.tally_catchup_status_of(p_book uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $function$
declare today date := (now() at time zone 'Asia/Kolkata')::date; t0 timestamptz; l int := 0; d int := 0; h int := 0; p tally_period_pulls%rowtype;
  going boolean;
begin
  t0 := (today::timestamp at time zone 'Asia/Kolkata');
  select * into p from tally_period_pulls where book_id = p_book;
  going := found and p.state = 'going';
  if going then
    select count(*) filter (where x.done_at is null and x.upload_at is null),
           count(*) filter (where x.done_at >= t0 and x.upload_at is null and x.done_at > coalesce(x.counted_at, x.done_at) + interval '1 second')
      into l, d from tally_period_days x
     where x.book_id = p_book and x.tally_n > 0 and x.day between p.fy_start and least((p.fy_start + interval '1 year' - interval '1 day')::date, today);
  end if;
  l := l + (select count(*) from tally_check_days c where c.book_id = p_book and c.done_at is null and c.upload_at is null and c.day <= today
             and not (going and exists (select 1 from tally_period_days x where x.book_id = c.book_id and x.day = c.day and x.tally_n > 0 and x.done_at is null and x.upload_at is null
                                        and x.day between p.fy_start and (p.fy_start + interval '1 year' - interval '1 day')::date)));
  d := d + (select count(*) from tally_check_days c where c.book_id = p_book and c.done_at >= t0 and c.upload_at is null and coalesce(c.added, 0) > 0);
  select count(*) into h from tally_period_day_retry r where r.book_id = p_book and r.retry_at > now();
  return jsonb_build_object('ok', true, 'n', l + d, 'left', l, 'held', h);
end $function$;

-- the page: one of the firm's own books (any member may read)
create or replace function public.tally_catchup_status(p_book uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $function$
begin
  if not tally_service_or_owner() then perform tally_period_member(p_book, false); end if;
  return tally_catchup_status_of(p_book);
end $function$;

revoke all on function public.tally_period_day_stop(uuid, date, text) from public, anon, authenticated;
grant execute on function public.tally_period_day_stop(uuid, date, text) to service_role;
revoke all on function public.tally_period_retry_days(uuid) from public, anon, authenticated;
grant execute on function public.tally_period_retry_days(uuid) to service_role;
revoke all on function public.tally_catchup_status_of(uuid) from public, anon, authenticated, service_role;
revoke all on function public.tally_catchup_status(uuid) from public, anon;
grant execute on function public.tally_catchup_status(uuid) to authenticated, service_role;

commit;
