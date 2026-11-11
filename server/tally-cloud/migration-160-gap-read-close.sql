-- migration-160-gap-read-close.sql (11-Nov-2026, branch next-gap-autoread). Written, NOT run yet: the owner reads it and runs it.
-- Why (staging, 11-Nov-2026, one book): Payment 481 was created in Tally (its recorder line came: AlterID 42869), altered
-- (its line never came) and deleted (the line without the entry's GUID, settled by the day check). Tally's ALTVCHID 42872,
-- FinCom's highest known 42869: the page said "3 entries made in Tally since 18:44 IST are not yet in FinCom. Upload the Day
-- Book for 11-Nov" and kept saying it. 158 queued the day, the bridge read Tally's Day Book of it (FinComDayHeads, the whole
-- day) after Tally's number was seen, and it matched FinCom; but 158 closes a gap only when settled deletes are as many as
-- the missing numbers (1 < 3): an alteration and a delete each take a number, and a deleted entry's last numbers are never
-- in any list. So only a hand upload closed it.
-- What 160 adds (nothing new is asked of Tally: the day read is 133's check day, FinComDayHeads and the entries it wants):
--   1. tally_gap_read_explains(book, gap_at, since, at, altvchid): the read explains the gap when ALL of these hold:
--        - Tally's number is the one FinCom saw when the gap's days were queued (158's tally_gap_numbers), not moved since;
--        - every day from the gap's first day (India's) to today (at most 7) was read whole by Tally (via 'day') AFTER that
--          number was first seen, and is done: FinCom holds every entry of the list at Tally's AlterID (133's want empty,
--          rechecked here), nothing left to remove, none given up (upload_at); no AlterID of the list above Tally's number;
--        - no line of the book received since the gap began is held or waiting;
--        - FinCom's highest known number (158's base: the copy's highest AlterID, deleted entries' too, the starting point,
--          the recorder's, a Day Book's, the last match's) is the AlterID of an entry of one of those days that is DELETED,
--          by a settled delete line received since the gap began (by its GUID, or the GUID Tally makes from the line's
--          MasterID), and the day was read after that line came; no live entry holds that number or above.
--      Then every number above it is accounted: an entry FinCom last knew at the highest number was changed in Tally after
--      that (its alterations, then its delete; each takes a number), and the read shows no entry of those days that FinCom
--      lacks or holds at another AlterID. A read that shows one never closes the gap: 133 wants it and the read brings it in
--      (tally_check_entries); the gap then closes as a plain match when FinCom holds Tally's number (150).
--      Residual (said plainly): a change to an entry dated on a day OUTSIDE the gap's days, made while the deleted entry was
--      still being changed, whose recorder line was lost, is not seen by the read.
--   2. tally_recorder_gap_asked (158's) replaced: 158's text unchanged, OR (1). The same arguments, grants restated.
--   3. tally_gap_closes (new table, service_role only) and a trigger on tally_sync_cursor: a gap closed that (1) explains is
--      recorded "checked against Tally at <the read's time>: ..." with the arithmetic.
--   4. tally_gap_front(book, max): the beat asks the bridge itself for the gap's days (newest first) once the gap is open 2
--      minutes, nothing of the book held, no posting of its company waiting (postings first), under 135's stop rules; each
--      day at most once per 15 minutes, a day read already read again (its history kept, as 158's trigger); none for a
--      day given up (upload_at), none 6 hours after the gap opened (then the upload, as before).
--   5. a trigger on tally_sync_cursor: the gap says checking: true while FinCom can read its days itself (at most 7 days,
--      none given up, the check not stopped, the period not paused, less than 6 hours open), else false: the page says
--      "Checking with Tally... (no action needed)" or asks for the upload as before.
-- Add-only: one new table (row security on, service_role only), four new functions, two new triggers; one function replaced
-- (158's tally_recorder_gap_asked, the same arguments, its grants restated: service_role only). No column, row or other
-- function changed. One transaction, lock_timeout 10 s; safe twice. Tested by tests/run_migration160.py (pg_stand) and
-- tests/run_gap_autoread_ingest.py (tally-ingest). Runs after 133, 135, 136, 150 and 158.
begin;
set local lock_timeout = '10s';

-- ---------------------------------------------------------------- 1. the read explains the gap
-- (p_base: FinCom's highest known number as it was before the gap closed, from the trigger of 3.; null: as now)
create or replace function public.tally_gap_read_explains(p_book uuid, p_gap_at timestamptz, p_since timestamptz, p_at timestamptz, p_altvchid bigint, p_base bigint default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $function$
declare n tally_gap_numbers%rowtype; c tally_sync_cursor%rowtype; a date; z date; k record; base bigint; cg text; e record; read_at timestamptz; ds text;
  no_ jsonb := jsonb_build_object('ok', false);
begin
  if p_book is null or p_gap_at is null or p_since is null or p_at is null or p_altvchid is null or p_since > p_at then return no_; end if;
  select * into n from tally_gap_numbers where book_id = p_book;
  if not found or n.altvchid <> p_altvchid or n.first_at < p_gap_at - interval '5 seconds' then return no_ || '{"why": "number"}'; end if;
  select * into c from tally_sync_cursor where book_id = p_book;
  if not found then return no_; end if;
  a := (p_since at time zone 'Asia/Kolkata')::date;
  z := greatest((p_at at time zone 'Asia/Kolkata')::date, (n.first_at at time zone 'Asia/Kolkata')::date);
  if a > z or z - a > 6 then return no_ || '{"why": "days"}'; end if;
  if exists (select 1 from tally_recorder_lines l where l.book_id = p_book and l.received_at >= p_since and l.state in ('held', 'received')) then return no_ || '{"why": "held"}'; end if;
  for k in select s.d::date as d, x.book_id, x.via, x.listed_at, x.done_at, x.upload_at, x.heads, x.seen
             from generate_series(a, z, interval '1 day') s(d) left join tally_check_days x on x.book_id = p_book and x.day = s.d::date loop
    if k.book_id is null or k.via is distinct from 'day' or k.listed_at is null or k.listed_at < n.first_at or k.done_at is null or k.upload_at is not null then
      return no_ || '{"why": "read"}';
    end if;
    if jsonb_array_length(tally_check_want(p_book, coalesce(k.heads, '[]'::jsonb), coalesce(k.seen, '{}'::jsonb) || coalesce((select y.seen from tally_period_days y where y.book_id = p_book and y.day = k.d), '{}'::jsonb))) > 0
       or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(k.heads) = 'array' then k.heads else '[]'::jsonb end) h
                   where jsonb_typeof(h) = 'array' and coalesce(h->>2, '') ~ '^[0-9]{1,15}$' and (h->>2)::bigint > p_altvchid) then
      return no_ || '{"why": "differs"}';
    end if;
    read_at := greatest(read_at, k.listed_at);
  end loop;
  base := coalesce(p_base, greatest(coalesce((select max(v.alter_id) from tally_vouchers v where v.book_id = p_book), 0),
                   coalesce((select max(d.alter_max) from tally_days d where d.book_id = p_book), 0),
                   coalesce(c.last_voucher_alterid, 0), coalesce(c.recorder_max_alter, 0),
                   coalesce(case when c.match_start is not distinct from c.start_at then c.match_alter end, 0)));
  if p_altvchid <= base then return jsonb_build_object('ok', true, 'base', base, 'missing', 0); end if;
  cg := lower(btrim(coalesce(c.start_guid, c.company_guid, '')));
  -- the entry FinCom last knew at its highest number: deleted (a settled line since the gap began), on a day read after it
  if exists (select 1 from tally_vouchers w where w.book_id = p_book and w.deleted_at is null and coalesce(w.alter_id, 0) >= base) then return no_ || '{"why": "live"}'; end if;
  select v.guid, v.vtype, v.vno, v.day into e from tally_vouchers v
   where v.book_id = p_book and v.alter_id = base and v.deleted_at is not null and v.day between a and z
     and exists (select 1 from tally_recorder_lines l
                  where l.book_id = p_book and l.event = 'deleted' and l.state in ('applied', 'duplicate', 'stale') and l.received_at >= p_since and l.vch_date = v.day
                    and (lower(coalesce(l.object_guid, '')) = lower(v.guid)
                         or ((l.object_guid is null or l.object_guid ~ '-0{8}$') and coalesce(l.master_id, '') ~ '^[0-9]{1,15}$' and l.master_id::bigint > 0
                             and lower(v.guid) = cg || '-' || lpad(to_hex(l.master_id::bigint), 8, '0')))
                    and not exists (select 1 from tally_check_days x where x.book_id = p_book and x.day = v.day and x.listed_at < l.received_at))
   order by v.guid limit 1;
  if e.guid is null then return no_ || '{"why": "unexplained"}'; end if;
  select string_agg(to_char(s.d, 'DD-Mon-YYYY'), ', ' order by s.d) into ds from generate_series(a, z, interval '1 day') s(d);
  return jsonb_build_object('ok', true, 'base', base, 'missing', p_altvchid - base, 'entry', e.guid, 'readAt', read_at,
    'words', format('checked against Tally at %s: Tally''s Day Book of %s matches FinCom; Tally''s change%s %s were %s %s''s changes after FinCom last had it and its deletion in Tally (it is removed from FinCom)',
                    to_char(read_at at time zone 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI') || ' IST', ds,
                    case when p_altvchid - base = 1 then '' else 's' end,
                    case when p_altvchid - base = 1 then p_altvchid::text else (base + 1)::text || ' to ' || p_altvchid::text end,
                    coalesce(nullif(e.vtype, ''), 'entry'), coalesce(e.vno, '')));
end $function$;

-- ---------------------------------------------------------------- 2. 158's rule, OR (160) the read explains it
create or replace function public.tally_recorder_gap_asked(p_book uuid, p_gap_at timestamptz, p_since timestamptz, p_at timestamptz, p_altvchid bigint)
returns boolean language sql stable security definer set search_path = public, pg_temp as $function$
  select p_gap_at is not null and p_since is not null and p_at is not null and p_altvchid is not null and p_since <= p_at
     and (
       (coalesce((select max(v.alter_id) from tally_vouchers v where v.book_id = p_book), 0) >= p_altvchid
        and not exists (select 1 from generate_series((p_since at time zone 'Asia/Kolkata')::date, (p_at at time zone 'Asia/Kolkata')::date, interval '1 day') s(d)
                         where not exists (select 1 from tally_check_days k where k.book_id = p_book and k.day = s.d::date
                                             and k.done_at is not null and k.done_at >= p_gap_at and k.upload_at is null)))
       or
       (exists (select 1 from tally_gap_numbers n where n.book_id = p_book and n.altvchid = p_altvchid and n.first_at >= p_gap_at - interval '5 seconds'
                  and not exists (select 1 from generate_series((p_since at time zone 'Asia/Kolkata')::date, greatest((p_at at time zone 'Asia/Kolkata')::date, (n.first_at at time zone 'Asia/Kolkata')::date), interval '1 day') s(d)
                                   where not exists (select 1 from tally_check_days k where k.book_id = p_book and k.day = s.d::date and k.via = 'day'
                                                       and k.listed_at >= n.first_at and k.done_at is not null and k.upload_at is null)))
        -- (review 1) every number above FinCom's highest known is explained by a settled delete / cancel (one entry each)
        and greatest(1, p_altvchid - (select greatest(coalesce((select max(v.alter_id) from tally_vouchers v where v.book_id = p_book), 0),
                                                       coalesce((select max(d.alter_max) from tally_days d where d.book_id = p_book), 0),
                                                       coalesce(c.last_voucher_alterid, 0), coalesce(c.recorder_max_alter, 0),
                                                       coalesce(case when c.match_start is not distinct from c.start_at then c.match_alter end, 0))
                                        from tally_sync_cursor c where c.book_id = p_book))
            <= (select count(distinct coalesce(lower(l.object_guid), l.master_id || '|' || coalesce(l.vch_type, '') || '|' || coalesce(l.vch_no, '') || '|' || coalesce(l.vch_date::text, '')))
                  from tally_recorder_lines l where l.book_id = p_book and l.event in ('deleted', 'cancelled') and l.received_at >= p_since
                   and l.state in ('applied', 'duplicate', 'stale'))
        and not exists (select 1 from tally_recorder_lines l where l.book_id = p_book and l.received_at >= p_since and l.state in ('held', 'received')))
       or
       -- 160: Tally's Day Book of the gap's days, read after Tally's number was seen, explains every number of it
       coalesce((tally_gap_read_explains(p_book, p_gap_at, p_since, p_at, p_altvchid)->>'ok')::boolean, false)
     )
$function$;

-- ---------------------------------------------------------------- 3. a gap the read closed, recorded with its words
create table if not exists public.tally_gap_closes (
  id        bigserial primary key,
  book_id   uuid not null references public.tally_books(book_id) on delete cascade,
  firm_id   uuid not null,
  at        timestamptz not null default now(),
  altvchid  bigint not null,
  base      bigint not null,
  words     text not null check (length(words) <= 600)
);
create index if not exists tally_gap_closes_book on public.tally_gap_closes (book_id, at desc);
alter table public.tally_gap_closes enable row level security;
grant select, insert on public.tally_gap_closes to service_role;
grant usage, select on sequence public.tally_gap_closes_id_seq to service_role;

-- a gap closed (gap -> null with a new match): when the read explains it, the words kept. Never fails what fired it
create or replace function public.tally_sync_cursor_gap_closed() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $function$
declare r jsonb; alt bigint;
begin
  begin
    alt := greatest(coalesce(new.match_alter, 0), case when coalesce(old.gap->>'tally_altvchid', '') ~ '^[0-9]{1,15}$' then (old.gap->>'tally_altvchid')::bigint else 0 end);
    if alt <= 0 or new.last_match_at is null then return null; end if;
    -- FinCom's highest known number as it was before the close (the match just recorded raised the cursor's)
    r := tally_gap_read_explains(new.book_id, old.gap_at, coalesce(old.last_match_at, old.start_at), new.last_match_at, alt,
           greatest(coalesce((select max(v.alter_id) from tally_vouchers v where v.book_id = new.book_id), 0),
                    coalesce((select max(d.alter_max) from tally_days d where d.book_id = new.book_id), 0),
                    coalesce(old.last_voucher_alterid, 0), coalesce(old.recorder_max_alter, 0),
                    coalesce(case when old.match_start is not distinct from old.start_at then old.match_alter end, 0)));
    if coalesce((r->>'ok')::boolean, false) and coalesce(r->>'words', '') <> '' then
      insert into tally_gap_closes (book_id, firm_id, altvchid, base, words) values (new.book_id, new.firm_id, alt, (r->>'base')::bigint, left(r->>'words', 600));
    end if;
  exception when others then
    raise log 'tally_sync_cursor_gap_closed: book %: % %', new.book_id, sqlstate, sqlerrm;
  end;
  return null;
end $function$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.tally_sync_cursor'::regclass and tgname = 'tally_sync_cursor_gap_closed' and not tgisinternal) then
    create trigger tally_sync_cursor_gap_closed after update of gap on public.tally_sync_cursor for each row
      when (old.gap is not null and new.gap is null) execute function public.tally_sync_cursor_gap_closed();
  end if;
end $$;

-- ---------------------------------------------------------------- 4. the beat asks the bridge for the gap's days itself
create or replace function public.tally_gap_front(p_book uuid, p_max integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $function$
declare c tally_sync_cursor%rowtype; bk tally_books%rowtype; r tally_check_runs%rowtype; p tally_period_pulls%rowtype; has_p boolean; ca timestamptz; out jsonb := '[]'::jsonb;
  d date; a date; z date := (now() at time zone 'Asia/Kolkata')::date; since_ timestamptz; lim int := least(greatest(coalesce(p_max, 1), 0), 7);
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_book is null or lim = 0 then return out; end if;
  select * into c from tally_sync_cursor where book_id = p_book;
  if not found or c.gap is null or c.gap_at is null or c.gap_at > now() - interval '2 minutes' or c.gap_at < now() - interval '6 hours' then return out; end if;
  if coalesce(c.gap->>'since', '') !~ '^\d{4}-\d\d-\d\d' then return out; end if;
  since_ := (c.gap->>'since')::timestamptz;
  a := (since_ at time zone 'Asia/Kolkata')::date;
  if a > z or z - a > 6 then return out; end if;
  -- nothing of the book held or waiting since the gap began (the held lines' own path goes first)
  if exists (select 1 from tally_recorder_lines l where l.book_id = p_book and l.received_at >= since_ and l.state in ('held', 'received')) then return out; end if;
  -- postings first: none while a posting of the book's company waits or runs
  select * into bk from tally_books where book_id = p_book;
  if exists (select 1 from tally_post_jobs j where j.firm_id = bk.firm_id and j.company = bk.company and j.status in ('waiting', 'taken', 'running')
               and j.created_at > now() - interval '1 day') then return out; end if;
  -- 135's stop rules
  select * into r from tally_check_runs where book_id = p_book;
  if not found or r.state <> 'going' then return out; end if;
  select * into p from tally_period_pulls where book_id = p_book;
  has_p := found;
  if has_p and p.state = 'paused' then return out; end if;
  if has_p and p.state = 'stopped' and not (r.chosen_at > coalesce(p.stopped_at, p.chosen_at)) then return out; end if;
  ca := case when has_p and p.state = 'going' then p.chosen_at else r.chosen_at end;
  for d in select s.d::date from generate_series(a, z, interval '1 day') s(d)
            where not exists (select 1 from tally_check_days k where k.book_id = p_book and k.day = s.d::date
                                and (k.upload_at is not null or (k.asked_at is not null and k.asked_at > now() - interval '15 minutes')))
            order by 1 desc limit lim loop
    out := out || jsonb_build_array(jsonb_build_object('day', to_char(d, 'YYYYMMDD'), 'fetch', true, 'chosenAt', ca, 'check', true, 'gap', true));
  end loop;
  if jsonb_array_length(out) = 0 then return out; end if;
  -- queued for 133's check (a day read already: read again; what its earlier checks found is kept, as 158's trigger)
  insert into tally_check_days (book_id, firm_id, day, source, queued_at)
  select p_book, c.firm_id, to_date(e->>'day', 'YYYYMMDD'), 'gap', now() from jsonb_array_elements(out) e
  on conflict (book_id, day) do update set source = 'gap', queued_at = now(), lists = 0, same = null, done_at = null
    where tally_check_days.done_at is not null and tally_check_days.upload_at is null;
  update tally_check_days x set asked_at = now(), first_asked_at = coalesce(x.first_asked_at, now())
   where x.book_id = p_book and x.day in (select to_date(e->>'day', 'YYYYMMDD') from jsonb_array_elements(out) e);
  return out;
end $function$;

-- ---------------------------------------------------------------- 5. the gap says whether FinCom is checking it itself
create or replace function public.tally_sync_cursor_gap_checking() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $function$
declare a date; z date := (now() at time zone 'Asia/Kolkata')::date; chk boolean := false; r tally_check_runs%rowtype; p tally_period_pulls%rowtype;
begin
  begin
    if coalesce(new.gap->>'since', '') ~ '^\d{4}-\d\d-\d\d' then
      a := ((new.gap->>'since')::timestamptz at time zone 'Asia/Kolkata')::date;
      select * into r from tally_check_runs where book_id = new.book_id;
      select * into p from tally_period_pulls where book_id = new.book_id;
      chk := a <= z and z - a <= 6 and (new.gap_at is null or new.gap_at > now() - interval '6 hours')
         and (r.book_id is null or r.state = 'going') and (p.book_id is null or p.state <> 'paused')
         and not exists (select 1 from tally_check_days k where k.book_id = new.book_id and k.day between a and z and k.upload_at is not null
                           and k.upload_at >= coalesce(new.gap_at, now()) - interval '5 seconds');
    end if;
    new.gap := new.gap || jsonb_build_object('checking', chk);
  exception when others then
    raise log 'tally_sync_cursor_gap_checking: book %: % %', new.book_id, sqlstate, sqlerrm;
  end;
  return new;
end $function$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.tally_sync_cursor'::regclass and tgname = 'tally_sync_cursor_gap_checking' and not tgisinternal) then
    create trigger tally_sync_cursor_gap_checking before insert or update of gap, gap_at on public.tally_sync_cursor for each row
      when (new.gap is not null and jsonb_typeof(new.gap) = 'object') execute function public.tally_sync_cursor_gap_checking();
  end if;
end $$;

-- ---------------------------------------------------------------- 6. who may call
revoke all on function public.tally_gap_read_explains(uuid, timestamptz, timestamptz, timestamptz, bigint, bigint), public.tally_gap_front(uuid, integer) from public, anon, authenticated;
grant execute on function public.tally_gap_read_explains(uuid, timestamptz, timestamptz, timestamptz, bigint, bigint), public.tally_gap_front(uuid, integer) to service_role;
revoke all on function public.tally_sync_cursor_gap_closed(), public.tally_sync_cursor_gap_checking() from public, anon, authenticated, service_role;
revoke all on function public.tally_recorder_gap_asked(uuid, timestamptz, timestamptz, timestamptz, bigint) from public, anon, authenticated;
grant execute on function public.tally_recorder_gap_asked(uuid, timestamptz, timestamptz, timestamptz, bigint) to service_role;

commit;
