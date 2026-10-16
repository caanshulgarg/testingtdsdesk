-- Migration 92 (16-Oct-2026, branch next-tally-one; the owner's report the same day: Books › From Tally listed "29 days need
-- a Day Book, N entries Tally sent could not be read · Upload" for GB TEXCOAT after three complete Day Book uploads of
-- 01-Apr-2025 to 12-Oct-2026). Read on staging: all 62 held lines of that book are 'deleted' lines with NO entry GUID (the
-- add-on named no entry), dated 01-Apr-2026 .. 09-Oct-2026, each received BEFORE a complete Day Book of its day was stored
-- (tally_days.n = the entries the copy holds live for the day). Their words promise "uploading the Day Book for <day> brings
-- that day up to date", and the upload did: the day import soft-marks every entry of the day that the file does not hold.
-- But nothing ever ended the line itself: tally_recorder_release_day runs again only the held lines it can tie to an entry of
-- the day (GUID, MasterID or type and number), and a GUID-less delete names none, so it stayed held for ever.
--
-- The rule (the same one migration 60 gives a delete or cancel that DOES name its entry): a held 'deleted' / 'cancelled' line
-- with no entry GUID (or the placeholder GUID ending -00000000) whose day has a COMPLETE Day Book stored AFTER the line arrived
-- has nothing left to do: it becomes 'applied' with words saying so. Nothing in the books changes (the Day Book already made
-- the day match Tally). A line with no date, an incomplete day, or a day stored before the line arrived stays held as now.
--
-- New: tally_recorder_settle_unnamed(uuid, date) and the trigger function tally_days_recorder_settle(), with two STATEMENT-level
-- triggers on tally_days (after insert, after update) named so that they fire after 50's release triggers (alphabetical).
-- Then once: the lines already held that the rule settles (staging, 16-Oct: 62 lines of GB TEXCOAT, 29 days).
-- ADD-ONLY: no table, column or row removed, no existing function replaced; only held_why / state / applied_at of the held
-- lines the rule settles change; safe to run twice; one transaction (lock_timeout 10 s). Tested on pg_stand only:
-- tests/run_migration92.py.

begin;
set local lock_timeout = '10s';

create or replace function public.tally_recorder_settle_unnamed(p_book uuid, p_day date) returns integer
language plpgsql security definer set search_path = public, pg_temp as $function$
declare d_at timestamptz; d_n int; d_live int; k int := 0;
begin
  if p_book is null or p_day is null then return 0; end if;
  select d.at, d.n into d_at, d_n from tally_days d where d.book_id = p_book and d.day = p_day;
  if d_at is null or d_n is null then return 0; end if;
  -- complete: the count the bridge or the upload vouched for equals the entries the copy holds live for the day
  select count(*) into d_live from tally_vouchers v where v.book_id = p_book and v.day = p_day and v.deleted_at is null;
  if d_n <> d_live then return 0; end if;
  update tally_recorder_lines l
     set state = 'applied', applied_at = now(),
         held_why = format('nothing left to do: the Day Book for %s, complete and stored after this change arrived, brought that day up to date in FinCom (the line named no entry)', to_char(p_day, 'DD-Mon-YYYY'))
   where l.book_id = p_book and l.vch_date = p_day and l.state = 'held' and l.event in ('deleted', 'cancelled')
     and (l.object_guid is null or l.object_guid ~ '-0{8}$') and l.received_at < d_at;
  get diagnostics k = row_count;
  return k;
end $function$;
revoke all on function public.tally_recorder_settle_unnamed(uuid, date) from public, anon, authenticated, service_role;

-- never fails the day: an error inside is caught and logged, the day kept (as 50's release trigger)
create or replace function public.tally_days_recorder_settle() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $function$
declare d record;
begin
  for d in select distinct n.book_id, n.day from new_days n
            where exists (select 1 from tally_recorder_lines l where l.book_id = n.book_id and l.vch_date = n.day and l.state = 'held' and l.event in ('deleted', 'cancelled'))
            order by n.book_id, n.day loop
    begin
      perform tally_recorder_settle_unnamed(d.book_id, d.day);
    exception when others then
      raise log 'tally_days_recorder_settle: book % day %: % %', d.book_id, d.day, sqlstate, sqlerrm;
    end;
  end loop;
  return null;
exception when query_canceled or others then
  raise log 'tally_days_recorder_settle: stopped (the days stored, the held lines left for the next store): % %', sqlstate, sqlerrm;
  return null;
end $function$;
revoke all on function public.tally_days_recorder_settle() from public, anon, authenticated, service_role;

do $$ begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.tally_days'::regclass and tgname = 'tally_days_recorder_settle_ins' and not tgisinternal) then
    create trigger tally_days_recorder_settle_ins after insert on public.tally_days referencing new table as new_days
      for each statement execute function public.tally_days_recorder_settle();
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.tally_days'::regclass and tgname = 'tally_days_recorder_settle_upd' and not tgisinternal) then
    create trigger tally_days_recorder_settle_upd after update on public.tally_days referencing new table as new_days
      for each statement execute function public.tally_days_recorder_settle();
  end if;
end $$;

-- once: the lines already held that the rule settles
do $$ declare d record; begin
  for d in select distinct l.book_id, l.vch_date from tally_recorder_lines l
            where l.state = 'held' and l.event in ('deleted', 'cancelled') and l.vch_date is not null
              and (l.object_guid is null or l.object_guid ~ '-0{8}$') order by 1, 2 loop
    perform public.tally_recorder_settle_unnamed(d.book_id, d.vch_date);
  end loop;
end $$;

commit;
