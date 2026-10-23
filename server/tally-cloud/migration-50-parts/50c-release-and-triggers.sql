-- Migration 50, part 3 of 4 (50c-release-and-triggers): the same text as server/tally-cloud/migration-50-recorder-held.sql, split so each part
-- fits a paste; run the parts in order, each once. Safe to run twice.
begin;
set local lock_timeout = '10s';

create index if not exists tally_recorder_lines_held_day on public.tally_recorder_lines (book_id, vch_date) where state = 'held';
create index if not exists tally_recorder_lines_held_master on public.tally_recorder_lines (book_id, master_id) where state = 'held';

-- internal: granted to nobody (the triggers on tally_days call it). Review M2: only the held lines the stored day CAN release:
-- those whose GUID is one of the day's entries (an entry line without a body only when the day's version is not older than it),
-- a placeholder / GUID-less line whose MasterID makes one of them or whose type and
-- number match one of them (dated that day), and a delete / cancel of that day (a complete Day Book can show the entry gone);
-- every one of them, oldest first (no window: none starves). Review L5: each is locked and re-checked still held. Review L2: a
-- re-run that errors keeps the line held, its words kept and the error said once
create or replace function public.tally_recorder_release_day(p_book uuid, p_day date)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare r tally_recorder_lines%rowtype; one jsonb; prev text := coalesce(current_setting('fincom.recorder_release', true), ''); n int := 0; a int := 0; f uuid; st text;
  x record; redone int := 0;
begin
  if p_book is null or p_day is null then return jsonb_build_object('ok', true, 'ran', 0, 'applied', 0); end if;
  select firm_id into f from tally_books where book_id = p_book;
  if f is null then return jsonb_build_object('ok', true, 'ran', 0, 'applied', 0); end if;
  perform pg_advisory_xact_lock(hashtext(p_book::text));
  -- round 2 (N1): a Day Book read again (an older kept file) never brings back an entry that a delete (cancel) line applied at a
  -- higher AlterID than the day's version of it took away: deleted (cancelled) again at once, through tally_ingest_delete
  perform set_config('fincom.recorder_release', '0', true);
  for x in select v.guid, l.event, max(l.alter_id) as alt from tally_vouchers v
             join tally_recorder_lines l on l.book_id = p_book and l.object_guid = v.guid and l.state = 'applied' and l.event in ('deleted', 'cancelled')
            where v.book_id = p_book and v.day = p_day and v.deleted_at is null and coalesce(l.alter_id, 0) > coalesce(v.alter_id, 0)
              and (l.event = 'deleted' or not v.cancelled)
            group by v.guid, l.event order by v.guid, l.event
  loop
    begin
      perform tally_ingest_delete(p_book, x.guid, x.alt, x.event = 'cancelled', 'recorder: an older Day Book read again');
      redone := redone + 1;
    exception when others then
      raise log 'tally_recorder_release_day: entry % of book % not %: % %', x.guid, p_book, x.event, sqlstate, sqlerrm;
    end;
  end loop;
  for r in
    with dv as (select v.guid, v.vtype, v.vno, coalesce(v.alter_id, 0) as alter_id,
                       case when v.guid ~ '-[0-9A-Fa-f]{8}$' then (('x' || right(v.guid, 8))::bit(32)::bigint)::text end as mid
                  from tally_vouchers v where v.book_id = p_book and v.day = p_day),
    cand as (
      select l.id from dv join tally_recorder_lines l on l.book_id = p_book and l.object_guid = dv.guid and l.state = 'held'
       -- an entry line without a body whose AlterID is above the day's version of it stays held whatever: not run
       where l.event in ('deleted', 'cancelled') or coalesce(l.body ? 'vouchers', false) or coalesce(l.alter_id, 0) <= dv.alter_id
      union
      select l.id from dv join tally_recorder_lines l on l.book_id = p_book and l.master_id = dv.mid and l.state = 'held'
       where l.object_guid is null or l.object_guid ~ '-0{8}$'
      union
      select l.id from tally_recorder_lines l
       where l.book_id = p_book and l.state = 'held' and l.vch_date = p_day
         and ((l.event in ('deleted', 'cancelled') and l.object_guid is not null)
              or ((l.object_guid is null or l.object_guid ~ '-0{8}$') and exists (select 1 from dv where dv.vtype = l.vch_type and dv.vno = l.vch_no))))
    select l.* from tally_recorder_lines l join cand c on c.id = l.id
     where l.event in ('created', 'altered', 'imported', 'deleted', 'cancelled')
       and coalesce(l.held_why, '') not like 'month locked%' and coalesce(l.held_why, '') not like 'FinCom id %'
     order by l.id
  loop
    begin
      select l.state into st from tally_recorder_lines l where l.id = r.id for update;
      if st is distinct from 'held' then continue; end if;
      -- as an owner's release runs it (tally_recorder_release_held): the stored line and its body, the row given
      perform set_config('fincom.recorder_release', r.id::text, true);
      one := tally_recorder_line(r.book_id, r.device_id, jsonb_build_object('line_id', r.line_id, 'event', r.event, 'object_guid', r.object_guid, 'alter_id', r.alter_id,
               'vch_date', r.vch_date, 'vch_no', r.vch_no, 'vch_type', r.vch_type, 'company_guid', r.company_guid, 'master_id', r.master_id, 'pc', r.pc, 'bridge', r.bridge) || coalesce(r.body, '{}'::jsonb), r.id);
      n := n + 1;
      if one->>'state' = 'failed' then
        update tally_recorder_lines set state = 'held',
               held_why = regexp_replace(coalesce(r.held_why, ''), ' \(a try to apply it by itself met an error: .*\)$', '') || ' (a try to apply it by itself met an error: ' || coalesce(one->>'why', 'unknown') || ')'
         where id = r.id;
        raise log 'tally_recorder_release_day: line % of book % kept held: %', r.id, p_book, one->>'why';
      -- applied now: its AlterID counts for the gap check as any applied line's
      elsif one->>'state' = 'applied' then
        a := a + 1;
        if r.alter_id is not null and r.alter_id < 1000000000000000 and coalesce(r.object_guid, '') !~ '-0{8}$' then
          insert into tally_sync_cursor (book_id, firm_id) values (p_book, f) on conflict (book_id) do nothing;
          update tally_sync_cursor set recorder_max_alter = greatest(coalesce(recorder_max_alter, 0), r.alter_id), recorder_last_at = now(), updated_at = now() where book_id = p_book;
        end if;
      end if;
    exception when others then
      raise log 'tally_recorder_release_day: line % of book % not run again: % %', r.id, p_book, sqlstate, sqlerrm;
    end;
  end loop;
  perform set_config('fincom.recorder_release', prev, true);
  return jsonb_build_object('ok', true, 'ran', n, 'applied', a, 'redone', redone);
end $function$;
revoke all on function public.tally_recorder_release_day(uuid, date) from public, anon, authenticated, service_role;

-- the triggers (review L6): STATEMENT level, one release per (book, day) a statement stored, from the transition table new_days
-- (tally_ingest_day's upsert fires the insert one or the update one). Review L1: a release never fails the day: an error or a
-- cancel (a statement timeout) inside it is caught and logged, its work undone, the day kept
create or replace function public.tally_days_recorder_release() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $function$
declare d record;
begin
  for d in select distinct n.book_id, n.day from new_days n
            where exists (select 1 from tally_recorder_lines l where l.book_id = n.book_id and l.state in ('held', 'applied') and l.event in ('created', 'altered', 'imported', 'deleted', 'cancelled'))
            order by n.book_id, n.day loop
    begin
      perform tally_recorder_release_day(d.book_id, d.day);
    exception when others then
      raise log 'tally_days_recorder_release: book % day %: % %', d.book_id, d.day, sqlstate, sqlerrm;
    end;
  end loop;
  return null;
exception when query_canceled or others then
  raise log 'tally_days_recorder_release: stopped (the days stored, the held lines left for the next store): % %', sqlstate, sqlerrm;
  return null;
end $function$;
revoke all on function public.tally_days_recorder_release() from public, anon, authenticated, service_role;
do $$ begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.tally_days'::regclass and tgname = 'tally_days_recorder_release_ins' and not tgisinternal) then
    create trigger tally_days_recorder_release_ins after insert on public.tally_days referencing new table as new_days
      for each statement execute function public.tally_days_recorder_release();
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.tally_days'::regclass and tgname = 'tally_days_recorder_release_upd' and not tgisinternal) then
    create trigger tally_days_recorder_release_upd after update on public.tally_days referencing new table as new_days
      for each statement execute function public.tally_days_recorder_release();
  end if;
end $$;

-- ---------------------------------------------------------------- the rows already held: the new words (held_why only)

commit;
