-- migration-136-held-settle.sql (02-Nov-2026, branch next-held-settle). The owner, 31-Oct-2026, on the Tally page's Sync
-- activity for one book (103 held lines, one "Needs you" row per day from 01-Oct to 01-Nov, plus "19 entries may have been
-- renumbered"): "I have updated the books now, why am I getting this; there should be an option to update the Day Book from
-- there only, and after the update it should close the error." Read on staging: the lines reached FinCom AFTER his Day Book
-- upload (his bridge sent its backlog when it started), so the upload could not settle them; 60 are 'deleted' lines with no
-- entry GUID, 43 'altered' lines whose entry FinCom holds and whose own AlterID is above the copy's. 133's day check (the
-- older-entries path, 135's queue) had already listed most of those days from Tally after the lines arrived and found FinCom
-- the same as Tally (Tally lists each of the 43 entries at the AlterID FinCom holds) - but nothing ended the lines.
-- What 136 adds (nothing new is asked of Tally; the check stays 133's: FinComDayHeads, then the entries FinCom lacks):
--   1. a day with held lines is queued by itself for 133's day check (source 'held'): when such a line arrives or is held
--      again (a statement trigger on tally_recorder_lines), and the days from a bridge's renumbering alert (a row trigger
--      on tally_devices when the beat's renumberAlerts change); never a day being checked, nor one already checked after
--      the lines arrived (except the second whole-day read below), nor one to upload by hand since then.
--   2. when a checked day is done (a row trigger on tally_check_days), its held lines are settled:
--        - 50/53's tally_recorder_release_day first (what a Day Book upload runs: the round-66 path), then
--        - an 'altered' / 'created' / 'imported' line whose entry FinCom holds live at an AlterID at or above the line's, or
--          that Tally's whole list of the day, taken after the line arrived, lists at the AlterID FinCom holds:
--          'duplicate' ("Already in the books"), with words saying when it was checked against Tally;
--        - a 'deleted' / 'cancelled' line with no entry GUID: only after TWO whole-day lists of its day, a minute or more
--          apart, both taken after the line arrived, the day done (FinCom holds nothing Tally does not list, 133's deletion
--          pass): 'applied' as 92 settles it on an upload. After the first list the day is queued again for the second.
--   3. an upload (a day stored in tally_days, complete, after the line arrived) settles an 'altered' line whose entry the
--      Day Book holds (92 already settles the GUID-less deletes; 50 the lines at or below the copy's AlterID).
--   4. tally_held_status(client): for the app (any member of the firm): per book, the held lines in plain counts, their
--      days, the check's progress and time left, and whether a renumbering alert's days are all checked since it.
--   Once, at the end: the lines already held are settled against the lists already taken, the first reads recorded, and
--   their days queued.
-- Add-only: one new table (its own grants: service_role only), new functions and six new triggers; no existing function,
-- table or column changed; only the state / held_why / applied_at of the held lines the rules settle change, and 133's
-- tally_check_days rows are queued as 133's tally_check_queue queues them. One transaction, lock_timeout 10 s, safe twice.
-- Tested by tests/run_migration136.py. Runs after 92, 133 and 135. No tally-ingest change.
begin;
set local lock_timeout = '10s';

-- ---------------------------------------------------------------- 1. the table
-- the whole-day lists of a day with held GUID-less deletes, taken after they arrived: the first and the second (a minute or
-- more later); a delete is settled only after both
create table if not exists public.tally_held_reads (
  book_id   uuid not null references public.tally_books(book_id) on delete cascade,
  firm_id   uuid not null,
  day       date not null,
  first_at  timestamptz,
  second_at timestamptz,
  primary key (book_id, day)
);
alter table public.tally_held_reads enable row level security;
grant select, insert, update, delete on public.tally_held_reads to service_role;

-- ---------------------------------------------------------------- 2. helpers (granted to nobody)
-- the held lines 136 looks after: a GUID-less delete or cancel with a date, or an entry line with its GUID (not the add-on's
-- placeholder) and a date; never a line of a locked month or one tied to a FinCom posting (their own ways out)
create or replace function public.tally_held_line_ours(p_event text, p_guid text, p_day date, p_why text) returns boolean
language sql immutable set search_path = public, pg_temp as $function$
  select p_day is not null and coalesce(p_why, '') not like 'month locked%' and coalesce(p_why, '') not like 'FinCom id %'
     and ((p_event in ('deleted', 'cancelled') and (p_guid is null or p_guid ~ '-0{8}$'))
       or (p_event in ('created', 'altered', 'imported') and p_guid is not null and p_guid !~ '-0{8}$'))
$function$;

-- a day's held lines settled by what FinCom now knows of the day: 50/53's re-run (as an upload runs it), then the entry
-- lines FinCom holds as Tally has them, then the GUID-less deletes after two whole-day lists. {entries, deletes}
create or replace function public.tally_held_settle_day(p_book uuid, p_day date) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $function$
declare c tally_check_days%rowtype; r tally_held_reads%rowtype; t tally_days%rowtype; t_ok boolean := false; ne int := 0; nd int := 0; at_txt text;
begin
  if p_book is null or p_day is null then return jsonb_build_object('entries', 0, 'deletes', 0); end if;
  if not exists (select 1 from tally_recorder_lines l where l.book_id = p_book and l.vch_date = p_day and l.state = 'held') then
    return jsonb_build_object('entries', 0, 'deletes', 0);
  end if;
  -- what FinCom knows of the day, read first (a line the re-run holds again may queue the day afresh)
  select * into c from tally_check_days where book_id = p_book and day = p_day;
  select * into r from tally_held_reads where book_id = p_book and day = p_day;
  select * into t from tally_days where book_id = p_book and day = p_day;
  begin
    perform tally_recorder_release_day(p_book, p_day);
  exception when others then
    raise log 'tally_held_settle_day: release of book % day %: % %', p_book, p_day, sqlstate, sqlerrm;
  end;
  if t.at is not null and t.n is not null then
    t_ok := t.n = (select count(*) from tally_vouchers v where v.book_id = p_book and v.day = p_day and v.deleted_at is null);
  end if;
  at_txt := to_char(coalesce(c.listed_at, now()) at time zone 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI');
  -- the entry lines: FinCom holds the entry live, and at or above the line's AlterID, or as Tally's whole list of the day
  -- (taken after the line arrived) has it, or as a complete Day Book of the day stored after the line arrived has it
  update tally_recorder_lines l
     set state = 'duplicate',
         held_why = case
           when coalesce(v.alter_id, 0) >= coalesce(l.alter_id, 0) then format('already in the books: FinCom holds this entry at AlterID %s', coalesce(v.alter_id, 0))
           when c.done_at is not null and c.via = 'day' and c.listed_at > l.received_at
                and exists (select 1 from jsonb_array_elements(case when jsonb_typeof(c.heads) = 'array' then c.heads else '[]'::jsonb end) h
                             where jsonb_typeof(h) = 'array' and h->>0 = l.object_guid and coalesce(h->>2, '') = coalesce(v.alter_id, 0)::text)
             then format('already in the books: checked against Tally on %s (Tally lists this entry at AlterID %s, as FinCom holds it)', at_txt, coalesce(v.alter_id, 0))
           else format('already in the books: the Day Book for %s, complete and stored after this change arrived, holds this entry (AlterID %s)', to_char(p_day, 'DD-Mon-YYYY'), coalesce(v.alter_id, 0)) end
    from tally_vouchers v
   where l.book_id = p_book and l.vch_date = p_day and l.state = 'held' and l.event in ('created', 'altered', 'imported')
     and tally_held_line_ours(l.event, l.object_guid, l.vch_date, l.held_why)
     and v.book_id = p_book and v.guid = l.object_guid and v.deleted_at is null
     and (coalesce(v.alter_id, 0) >= coalesce(l.alter_id, 0)
          or (c.done_at is not null and c.via = 'day' and c.listed_at > l.received_at
              and exists (select 1 from jsonb_array_elements(case when jsonb_typeof(c.heads) = 'array' then c.heads else '[]'::jsonb end) h
                           where jsonb_typeof(h) = 'array' and h->>0 = l.object_guid and coalesce(h->>2, '') = coalesce(v.alter_id, 0)::text))
          or (t_ok and t.at > l.received_at and v.day = p_day));
  get diagnostics ne = row_count;
  -- the GUID-less deletes: two whole-day lists a minute or more apart, both after the line arrived, the day done since
  if r.second_at is not null and r.first_at is not null and c.done_at is not null and c.via = 'day' and c.listed_at >= r.second_at then
    update tally_recorder_lines l
       set state = 'applied', applied_at = now(),
           held_why = format('nothing left to do: checked against Tally on %s - Tally''s whole list of %s, read twice a minute or more apart, matches FinCom (the line named no entry)',
                             to_char(r.second_at at time zone 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI'), to_char(p_day, 'DD-Mon-YYYY'))
     where l.book_id = p_book and l.vch_date = p_day and l.state = 'held' and l.event in ('deleted', 'cancelled')
       and tally_held_line_ours(l.event, l.object_guid, l.vch_date, l.held_why) and l.received_at < r.first_at;
    get diagnostics nd = row_count;
  end if;
  return jsonb_build_object('entries', ne, 'deletes', nd);
end $function$;

-- queue a book's days with held lines (p_days null: every such day) for 133's day check, source 'held'. A day is queued
-- when it has no check yet, or its last list (or its "upload by hand") is older than its newest held line, or its
-- GUID-less deletes still wait for the second whole-day list (the first one recorded); never a day being checked. At
-- most 400 days a call (the newest). The number queued
create or replace function public.tally_held_queue_of(p_book uuid, p_days date[]) returns integer
language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid; today date := (now() at time zone 'Asia/Kolkata')::date; x record; c tally_check_days%rowtype; r tally_held_reads%rowtype; want date[] := '{}'; n int := 0;
begin
  select firm_id into f from tally_books where book_id = p_book;
  if f is null then return 0; end if;
  for x in select l.vch_date as day, max(l.received_at) as mx,
                  max(l.received_at) filter (where l.event in ('deleted', 'cancelled')) as mxd
             from tally_recorder_lines l
            where l.book_id = p_book and l.state = 'held' and l.vch_date <= today and l.vch_date >= date '2000-04-01'
              and (p_days is null or l.vch_date = any (p_days))
              and tally_held_line_ours(l.event, l.object_guid, l.vch_date, l.held_why)
            group by l.vch_date order by l.vch_date desc limit 400 loop
    select * into c from tally_check_days where book_id = p_book and day = x.day;
    if c.book_id is null then want := want || x.day; continue; end if;
    if c.done_at is null and c.upload_at is null then continue; end if;                       -- being checked
    if c.upload_at is not null then
      if c.upload_at < x.mx then want := want || x.day; end if;                              -- given up before these lines
      continue;
    end if;
    if c.listed_at is null or c.listed_at < x.mx then want := want || x.day; continue; end if;  -- listed before these lines
    -- listed after them; the GUID-less deletes wait for a second whole-day list: the first recorded, the day queued again
    if x.mxd is not null and c.via = 'day' then
      select * into r from tally_held_reads where book_id = p_book and day = x.day;
      if r.second_at is null or r.first_at is null or r.first_at < x.mxd then
        insert into tally_held_reads (book_id, firm_id, day, first_at) values (p_book, f, x.day, c.listed_at)
        on conflict (book_id, day) do update set first_at = excluded.first_at, second_at = null
          where tally_held_reads.first_at is null or tally_held_reads.first_at < x.mxd;
        want := want || x.day;
      end if;
    end if;
  end loop;
  if array_length(want, 1) is null then return 0; end if;
  insert into tally_check_runs (book_id, firm_id) values (p_book, f) on conflict (book_id) do nothing;
  insert into tally_check_days (book_id, firm_id, day, source, queued_at)
  select p_book, f, d, 'held', now() from unnest(want) d
  on conflict (book_id, day) do update set source = excluded.source, queued_at = now(), asked_at = null, first_asked_at = null, lists = 0, tally_n = null, heads = null, via = null,
    listed_at = null, gone1 = null, gone1_at = null, added = 0, updated = 0, removed = 0, same = null, done_at = null, upload_at = null, upload_words = null
    where not (tally_check_days.done_at is null and tally_check_days.upload_at is null);
  get diagnostics n = row_count;
  return n;
end $function$;

-- a bridge's renumbering alerts for a book (its company by name, as the beat names it): [{from, at, n, more}] (the beat's
-- 'at' is the Tally computer's own time, India's)
create or replace function public.tally_held_renumber_of(p_book uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $function$
  select coalesce(jsonb_agg(jsonb_build_object('from', to_date(a->>'from', 'YYYYMMDD'), 'at', (a->>'at')::timestamp at time zone 'Asia/Kolkata', 'n', coalesce((a->>'n')::int, 0), 'more', coalesce((a->>'more')::boolean, false))
           order by a->>'from'), '[]'::jsonb)
    from tally_books b join tally_devices d on d.firm_id = b.firm_id and not coalesce(d.revoked, false),
         jsonb_array_elements(case when jsonb_typeof(d.info->'beat'->'renumberAlerts') = 'array' then d.info->'beat'->'renumberAlerts' else '[]'::jsonb end) a
   where b.book_id = p_book and lower(btrim(coalesce(a->>'company', ''))) = lower(btrim(b.company))
     and coalesce(a->>'from', '') ~ '^[0-9]{8}$' and coalesce(a->>'at', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}$'
$function$;

-- the days of a book's renumbering alerts, from each alert's first day to its own day (India's), not listed whole nor
-- stored from a Day Book since the alert: queued for the check (at most 400, the newest)
create or replace function public.tally_held_queue_renumber(p_book uuid) returns integer
language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid; today date := (now() at time zone 'Asia/Kolkata')::date; a jsonb; want date[] := '{}'; n int := 0;
begin
  select firm_id into f from tally_books where book_id = p_book;
  if f is null then return 0; end if;
  for a in select jsonb_array_elements(tally_held_renumber_of(p_book)) loop
    want := want || array(
      select d::date from generate_series((a->>'from')::date, least(today, ((a->>'at')::timestamptz at time zone 'Asia/Kolkata')::date), interval '1 day') d
       where not exists (select 1 from tally_check_days c where c.book_id = p_book and c.day = d::date
                           and ((c.done_at is null and c.upload_at is null) or (c.via = 'day' and c.listed_at > (a->>'at')::timestamptz)))
         and not exists (select 1 from tally_days t where t.book_id = p_book and t.day = d::date and t.at > (a->>'at')::timestamptz));
  end loop;
  want := array(select distinct d from unnest(want) d where d >= date '2000-04-01' order by d desc limit 400);
  if array_length(want, 1) is null then return 0; end if;
  insert into tally_check_runs (book_id, firm_id) values (p_book, f) on conflict (book_id) do nothing;
  insert into tally_check_days (book_id, firm_id, day, source, queued_at)
  select p_book, f, d, 'held', now() from unnest(want) d
  on conflict (book_id, day) do update set source = excluded.source, queued_at = now(), asked_at = null, first_asked_at = null, lists = 0, tally_n = null, heads = null, via = null,
    listed_at = null, gone1 = null, gone1_at = null, added = 0, updated = 0, removed = 0, same = null, done_at = null, upload_at = null, upload_words = null
    where not (tally_check_days.done_at is null and tally_check_days.upload_at is null);
  get diagnostics n = row_count;
  return n;
end $function$;

-- ---------------------------------------------------------------- 3. the triggers (each never fails what fired it)
-- a line held (arrived, or held again): its book's days queued
create or replace function public.tally_recorder_lines_held_queue() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $function$
declare x record;
begin
  for x in select n.book_id, array_agg(distinct n.vch_date) as days from new_lines n
            where n.state = 'held' and tally_held_line_ours(n.event, n.object_guid, n.vch_date, n.held_why) group by n.book_id loop
    begin
      perform tally_held_queue_of(x.book_id, x.days);
    exception when others then
      raise log 'tally_recorder_lines_held_queue: book %: % %', x.book_id, sqlstate, sqlerrm;
    end;
  end loop;
  return null;
exception when query_canceled or others then
  raise log 'tally_recorder_lines_held_queue: stopped (the lines kept): % %', sqlstate, sqlerrm;
  return null;
end $function$;

-- a computer's renumbering alerts changed: the days of the books they name queued
create or replace function public.tally_devices_renumber_queue() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $function$
declare b uuid;
begin
  for b in select k.book_id from tally_books k
            where k.firm_id = new.firm_id
              and exists (select 1 from jsonb_array_elements(case when jsonb_typeof(new.info->'beat'->'renumberAlerts') = 'array' then new.info->'beat'->'renumberAlerts' else '[]'::jsonb end) a
                           where lower(btrim(coalesce(a->>'company', ''))) = lower(btrim(k.company))) loop
    begin
      perform tally_held_queue_renumber(b);
    exception when others then
      raise log 'tally_devices_renumber_queue: book %: % %', b, sqlstate, sqlerrm;
    end;
  end loop;
  return null;
exception when query_canceled or others then
  raise log 'tally_devices_renumber_queue: stopped (the beat kept): % %', sqlstate, sqlerrm;
  return null;
end $function$;

-- a checked day done: the whole-day list recorded (first or second), the day's held lines settled, and the day queued
-- again when its GUID-less deletes still wait for the second list
create or replace function public.tally_check_days_held_settle() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $function$
declare mxd timestamptz; r tally_held_reads%rowtype;
begin
  if not exists (select 1 from tally_recorder_lines l where l.book_id = new.book_id and l.vch_date = new.day and l.state = 'held') then return null; end if;
  begin
    select max(l.received_at) into mxd from tally_recorder_lines l
     where l.book_id = new.book_id and l.vch_date = new.day and l.state = 'held' and l.event in ('deleted', 'cancelled')
       and tally_held_line_ours(l.event, l.object_guid, l.vch_date, l.held_why);
    if mxd is not null and new.via = 'day' and new.listed_at > mxd then
      select * into r from tally_held_reads where book_id = new.book_id and day = new.day;
      if r.book_id is null or r.first_at is null or r.first_at < mxd then
        insert into tally_held_reads (book_id, firm_id, day, first_at) values (new.book_id, new.firm_id, new.day, new.listed_at)
        on conflict (book_id, day) do update set first_at = excluded.first_at, second_at = null;
      elsif new.listed_at >= r.first_at + interval '60 seconds' then
        update tally_held_reads set second_at = new.listed_at where book_id = new.book_id and day = new.day;
      end if;
    end if;
    perform tally_held_settle_day(new.book_id, new.day);
    -- the second whole-day list still to take: the day asked again (after the others: handed out at least a minute on)
    if mxd is not null and new.via = 'day' and new.listed_at > mxd
       and exists (select 1 from tally_recorder_lines l where l.book_id = new.book_id and l.vch_date = new.day and l.state = 'held' and l.event in ('deleted', 'cancelled')
                    and tally_held_line_ours(l.event, l.object_guid, l.vch_date, l.held_why))
       and not exists (select 1 from tally_held_reads h where h.book_id = new.book_id and h.day = new.day and h.second_at is not null) then
      update tally_check_days set done_at = null, same = null, asked_at = now(), source = 'held' where book_id = new.book_id and day = new.day and done_at is not null;
    end if;
  exception when others then
    raise log 'tally_check_days_held_settle: book % day %: % %', new.book_id, new.day, sqlstate, sqlerrm;
  end;
  return null;
end $function$;

-- a Day Book day stored: the entry lines its entries settle (92 settles the GUID-less deletes, 50 the rest)
create or replace function public.tally_days_held_settle() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $function$
declare d record;
begin
  for d in select distinct n.book_id, n.day from new_days n
            where exists (select 1 from tally_recorder_lines l where l.book_id = n.book_id and l.vch_date = n.day and l.state = 'held' and l.event in ('created', 'altered', 'imported'))
            order by n.book_id, n.day loop
    begin
      perform tally_held_settle_day(d.book_id, d.day);
    exception when others then
      raise log 'tally_days_held_settle: book % day %: % %', d.book_id, d.day, sqlstate, sqlerrm;
    end;
  end loop;
  return null;
exception when query_canceled or others then
  raise log 'tally_days_held_settle: stopped (the days stored): % %', sqlstate, sqlerrm;
  return null;
end $function$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.tally_recorder_lines'::regclass and tgname = 'tally_recorder_lines_held_queue_ins' and not tgisinternal) then
    create trigger tally_recorder_lines_held_queue_ins after insert on public.tally_recorder_lines referencing new table as new_lines
      for each statement execute function public.tally_recorder_lines_held_queue();
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.tally_recorder_lines'::regclass and tgname = 'tally_recorder_lines_held_queue_upd' and not tgisinternal) then
    create trigger tally_recorder_lines_held_queue_upd after update on public.tally_recorder_lines referencing new table as new_lines
      for each statement execute function public.tally_recorder_lines_held_queue();
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.tally_devices'::regclass and tgname = 'tally_devices_renumber_queue' and not tgisinternal) then
    create trigger tally_devices_renumber_queue after update of info on public.tally_devices for each row
      when (new.info->'beat'->'renumberAlerts' is not null and old.info->'beat'->'renumberAlerts' is distinct from new.info->'beat'->'renumberAlerts')
      execute function public.tally_devices_renumber_queue();
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.tally_check_days'::regclass and tgname = 'tally_check_days_held_settle' and not tgisinternal) then
    create trigger tally_check_days_held_settle after update on public.tally_check_days for each row
      when (old.done_at is null and new.done_at is not null)
      execute function public.tally_check_days_held_settle();
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.tally_days'::regclass and tgname = 'tally_days_recorder_settle_seen_ins' and not tgisinternal) then
    create trigger tally_days_recorder_settle_seen_ins after insert on public.tally_days referencing new table as new_days
      for each statement execute function public.tally_days_held_settle();
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.tally_days'::regclass and tgname = 'tally_days_recorder_settle_seen_upd' and not tgisinternal) then
    create trigger tally_days_recorder_settle_seen_upd after update on public.tally_days referencing new table as new_days
      for each statement execute function public.tally_days_held_settle();
  end if;
end $$;

-- ---------------------------------------------------------------- 4. the app (any member of the firm; reads only)
-- per book of the firm (or the client's) with held lines 136 looks after, or days it queued in the last two days: the held
-- lines (all, the GUID-less deletes, the entry lines), their first and last day, the days; the check of its days (total,
-- done, waiting, to upload by hand, the time left, its state and the bridge's stop); whether a computer reads older entries
-- for the firm; each renumbering alert with whether every day from its first day to its own is checked (listed whole or
-- stored from a Day Book) since it
create or replace function public.tally_held_status(p_client text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); out jsonb := '[]'::jsonb; b record; h record; c record; run tally_check_runs%rowtype; rn jsonb; ren jsonb; a jsonb; rate numeric; eta int; st text; fo boolean;
  today date := (now() at time zone 'Asia/Kolkata')::date; ad date; ok boolean;
begin
  if f is null then raise exception 'not allowed' using errcode = '42501'; end if;
  select exists (select 1 from tally_devices d where d.firm_id = f and not coalesce(d.revoked, false) and coalesce(d.period_fetch, false)) into fo;
  for b in select k.book_id, k.client_id, k.company from tally_books k where k.firm_id = f and (p_client is null or k.client_id = p_client) order by k.company, k.book_id loop
    select count(*)::int as n, count(*) filter (where l.event in ('deleted', 'cancelled'))::int as dels, count(*) filter (where l.event not in ('deleted', 'cancelled'))::int as ents,
           min(l.vch_date) as d0, max(l.vch_date) as d1, coalesce(jsonb_agg(distinct to_char(l.vch_date, 'YYYYMMDD')), '[]'::jsonb) as days
      into h from tally_recorder_lines l
     where l.book_id = b.book_id and l.state = 'held' and tally_held_line_ours(l.event, l.object_guid, l.vch_date, l.held_why);
    select count(*)::int as total, count(*) filter (where d.done_at is not null and d.upload_at is null)::int as done_n,
           count(*) filter (where d.done_at is null and d.upload_at is null)::int as waiting, count(*) filter (where d.upload_at is not null)::int as upload,
           least(30, extract(epoch from now() - min(coalesce(d.first_asked_at, d.asked_at))) / 60) as mins
      into c from tally_check_days d where d.book_id = b.book_id and d.source = 'held' and d.queued_at > now() - interval '2 days';
    rn := tally_held_renumber_of(b.book_id);
    if h.n = 0 and c.total = 0 and jsonb_array_length(rn) = 0 then continue; end if;
    select * into run from tally_check_runs where book_id = b.book_id;
    rate := case when c.mins >= 2 and c.done_n > 0 then c.done_n / c.mins end;
    eta := case when c.waiting > 0 and rate > 0 then greatest(1, round(c.waiting / rate))::int end;
    st := case when run.book_id is not null and run.state = 'stopped' and c.waiting > 0 then 'stopped' when not fo and c.waiting > 0 then 'off'
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
                                  'words', case when st = 'stopped' then run.stop_words end),
      'fetchOn', fo, 'renumber', ren));
  end loop;
  return jsonb_build_object('ok', true, 'books', out);
end $function$;

-- ---------------------------------------------------------------- 5. who may call
revoke all on function public.tally_held_line_ours(text, text, date, text), public.tally_held_settle_day(uuid, date), public.tally_held_queue_of(uuid, date[]),
  public.tally_held_renumber_of(uuid), public.tally_held_queue_renumber(uuid), public.tally_recorder_lines_held_queue(), public.tally_devices_renumber_queue(),
  public.tally_check_days_held_settle(), public.tally_days_held_settle() from public, anon, authenticated, service_role;
revoke all on function public.tally_held_status(text) from public, anon;
grant execute on function public.tally_held_status(text) to authenticated, service_role;

-- ---------------------------------------------------------------- 6. once: the lines already held
-- settled against what FinCom already knows (the lists already taken after them, the Day Books stored after them); the
-- first whole-day reads recorded and the days queued (the second read for the GUID-less deletes); a renumbering alert's days
do $$ declare x record; begin
  for x in select distinct l.book_id, l.vch_date from tally_recorder_lines l
            where l.state = 'held' and tally_held_line_ours(l.event, l.object_guid, l.vch_date, l.held_why) order by 1, 2 loop
    begin
      perform public.tally_held_settle_day(x.book_id, x.vch_date);
    exception when others then
      raise log 'migration 136: book % day %: % %', x.book_id, x.vch_date, sqlstate, sqlerrm;
    end;
  end loop;
  for x in select distinct l.book_id from tally_recorder_lines l
            where l.state = 'held' and tally_held_line_ours(l.event, l.object_guid, l.vch_date, l.held_why) order by 1 loop
    perform public.tally_held_queue_of(x.book_id, null);
  end loop;
  for x in select distinct k.book_id from tally_books k join tally_devices d on d.firm_id = k.firm_id
            where jsonb_typeof(d.info->'beat'->'renumberAlerts') = 'array' order by 1 loop
    perform public.tally_held_queue_renumber(x.book_id);
  end loop;
end $$;

commit;
