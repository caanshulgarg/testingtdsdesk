-- migration-158-held-delete-fast.sql (11-Nov-2026, branch next-fast-delete). Written, NOT run yet: the owner reads it and runs it.
-- Why (staging, 11-Nov-2026, one book): Payment 481 was created in Tally, altered, then deleted at 18:44 IST. The add-on's
-- delete line came without the entry's GUID (as on every real TallyPrime: tally_recorder_lines id 1508, 'held', "no entry
-- GUID on the line"), with Tally's MasterID 26524, the date, number and type. 136 queued the day at once (source 'held')
-- and the bridge listed it 60 s later; but 133 removes an entry Tally no longer lists only on a SECOND whole-day list a
-- minute or more after the first, and the second came 3 minutes later: the entry left FinCom at 18:48:23, the line at
-- 18:50:42. Then the recorder's gap: Tally's ALTVCHID went 42868 -> 42872, the copy's highest AlterID stays 42869 (the
-- deleted entry's, from its create), so 150's supporting rule (the copy holds an entry at Tally's number) can never hold
-- after a delete, and the gap opened at 18:53:07 - after the day was checked - stays open: the page says "3 entries made
-- in Tally since 18:44 IST are not yet in FinCom", which is false.
-- What 158 adds (nothing new is asked of Tally: the day check stays 133's FinComDayHeads list):
--   1. tally_held_delete_by_heads(book, day, heads, device, bridge): called by tally-ingest with a WHOLE-day list of a day
--      being checked, before 133's tally_check_heads. A held GUID-less 'deleted' line of that day is applied at once, on this
--      first list, when ALL of these hold (else 133/136's two lists as before):
--        - the line names Tally's MasterID, its number and type, and the book's company GUID (the line's own); it came from
--          the computer and bridge that sent the list, in the last 10 minutes;
--        - FinCom held the entry's version it holds now BEFORE the line arrived (tally_voucher_versions.seen_at): a new entry
--          made after the delete with the same number and MasterID, taken by FinCom later, is never removed (review 2);
--        - FinCom holds exactly ONE live entry of that day with that number and type, and its GUID is the GUID Tally makes
--          for that MasterID (<company GUID>-<MasterID in 8 hex digits>; an entry that came by import keeps another GUID
--          and is never matched);
--        - the list is not empty (42: an empty day is read twice) and names neither that GUID nor that MasterID (as a
--          number: leading zeros never hide it).
--      Two proofs, each from Tally: the recorder line says that very entry (MasterID, number, type, date) was deleted,
--      and this bridge's Tally's whole list of the day, taken now, no longer has it. The second list guarded against a
--      list missing an entry by chance; that it misses exactly the entry a delete line names is not chance. A locked month
--      is left to its own words. The entry goes through 57's tally_ingest_delete and 133's log ('check', 'deleted').
--   2. tally_held_front(book, device, bridge, max): the days of the book with a held GUID-less delete / cancel from THIS
--      bridge, being checked, not asked in the last 3 minutes: handed out FIRST in the beat (before the period's days,
--      which could fill a 3-day answer), under 135's own stop rules. At most once per day per 3 minutes.
--   3. the gap: a new table tally_gap_numbers (book, Tally's number in the open gap, when FinCom first saw it), kept by a
--      trigger on tally_sync_cursor; the same trigger queues the gap's days (at most 7, from the gap's first day to today,
--      India's) for 133's check (source 'gap') when none was listed whole after that number was seen; and
--      tally_recorder_gap_asked (150) replaced: as 150, OR every day of the gap listed whole by Tally and done AFTER
--      FinCom first saw Tally's number now (so every change up to that number is in those lists), none open or left to
--      upload, Tally's number not moved since, and the gap EXPLAINED by deletes (review 1): Tally's number less FinCom's
--      highest known (the copy's highest AlterID, deleted entries' too, the starting point, the recorder's, a Day Book's,
--      the last match's) is at most the number of settled 'deleted' / 'cancelled' lines (one entry each) received since
--      the gap began; no line of the book received since still held. Any number more stays a gap (150's rule for it: a
--      change dated on a day not listed, e.g. a journal of 01-Oct made today whose line never came). 47/150's queued-send
--      check (lost = 0) still applies in tally_recorder_gap_check. The trigger re-queues a day only (source, queued and
--      asked times, its count of lists this round); what the day's earlier checks found (heads, removed, ...) is kept.
-- Add-only: one new table (row security on, service_role only), three new functions, one new trigger; one function
-- replaced (150's tally_recorder_gap_asked, the same arguments, its grants restated: service_role only). No column,
-- row or other function changed. One transaction, lock_timeout 10 s; safe twice. Tested by tests/run_migration158.py
-- (pg_stand) and tests/run_held_delete_fast_ingest.py (tally-ingest). Runs after 133, 135, 136 and 150.
begin;
set local lock_timeout = '10s';

-- ---------------------------------------------------------------- 1. a held GUID-less delete applied on the first whole list
create or replace function public.tally_held_delete_by_heads(p_book uuid, p_day date, p_heads jsonb, p_device uuid, p_bridge text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $function$
declare cg text; f uuid; l record; g text; hx text; mid bigint; nv int; vg text; va bigint; res jsonb; n int := 0; done jsonb := '[]'::jsonb;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_book is null or p_day is null or p_device is null or coalesce(p_bridge, '') = ''
     or jsonb_typeof(coalesce(p_heads, 'null'::jsonb)) <> 'array' or jsonb_array_length(p_heads) = 0 then
    return jsonb_build_object('ok', true, 'removed', 0);
  end if;
  if not exists (select 1 from tally_check_days k where k.book_id = p_book and k.day = p_day and k.done_at is null and k.upload_at is null) then
    return jsonb_build_object('ok', true, 'mine', false, 'removed', 0);
  end if;
  select lower(btrim(coalesce(c.start_guid, c.company_guid))), c.firm_id into cg, f from tally_sync_cursor c where c.book_id = p_book;
  if coalesce(cg, '') !~ '^[0-9a-f][0-9a-f-]{7,99}$' then return jsonb_build_object('ok', true, 'mine', true, 'removed', 0); end if;
  for l in select x.id, x.master_id, x.vch_no, x.vch_type, x.received_at from tally_recorder_lines x
            where x.book_id = p_book and x.vch_date = p_day and x.state = 'held' and x.event = 'deleted'
              and x.device_id = p_device and x.bridge = p_bridge and x.received_at > now() - interval '10 minutes'
              and (x.object_guid is null or x.object_guid ~ '-0{8}$')
              and coalesce(x.master_id, '') ~ '^[0-9]{1,15}$' and x.master_id::bigint > 0
              and lower(btrim(coalesce(x.company_guid, ''))) = cg
              and btrim(coalesce(x.vch_no, '')) <> '' and btrim(coalesce(x.vch_type, '')) <> ''
              and coalesce(x.held_why, '') not like 'month locked%' and coalesce(x.held_why, '') not like 'FinCom id %'
            order by x.id loop
    mid := l.master_id::bigint; hx := to_hex(mid);
    g := cg || '-' || case when length(hx) < 8 then lpad(hx, 8, '0') else hx end;
    -- this Tally's whole list of the day names neither that GUID nor that MasterID
    continue when exists (select 1 from jsonb_array_elements(p_heads) h
                           where jsonb_typeof(h) <> 'array' or lower(coalesce(h->>0, '')) = g
                              or (coalesce(h->>1, '') ~ '^[0-9]{1,15}$' and (h->>1)::bigint = mid));
    -- exactly one live entry of the day with the line's number and type, and it is that GUID
    select count(*), min(v.guid), min(v.alter_id) into nv, vg, va from tally_vouchers v
     where v.book_id = p_book and v.day = p_day and v.deleted_at is null and v.vno = l.vch_no and v.vtype = l.vch_type;
    continue when nv <> 1 or lower(vg) <> g or va is null;
    -- (review 2) the version FinCom holds now was held before the delete line arrived (a MasterID reused by a new entry
    -- taken later is never removed by an older delete line)
    continue when not exists (select 1 from tally_voucher_versions vv where vv.book_id = p_book and vv.tally_guid = vg and vv.alter_id = va and vv.seen_at <= l.received_at);
    res := tally_ingest_delete(p_book, vg, null, false, 'day check: deleted in Tally (MasterID)');
    continue when coalesce(res->>'state', '') <> 'applied' or coalesce((res->>'already')::boolean, false);
    insert into tally_fetch_log (book_id, firm_id, via, what, guid, day) values (p_book, f, 'check', 'deleted', vg, p_day);
    update tally_recorder_lines set state = 'applied', applied_at = now(),
           held_why = format('deleted in Tally: %s %s of %s (Tally''s MasterID %s) removed from FinCom - Tally''s whole list of the day, read %s, no longer has it',
                             l.vch_type, l.vch_no, to_char(p_day, 'DD-Mon-YYYY'), mid, to_char(now() at time zone 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI'))
     where id = l.id and state = 'held';
    n := n + 1; done := done || to_jsonb(vg);
  end loop;
  return jsonb_build_object('ok', true, 'mine', true, 'removed', n, 'guids', done);
end $function$;

-- ---------------------------------------------------------------- 2. the day of a held delete first in the beat
-- 135's tally_check_next_open's stop rules; only days with a held GUID-less delete / cancel from this computer's bridge
-- (the one whose Tally saw it), being checked, not asked in the last 3 minutes (newest first)
create or replace function public.tally_held_front(p_book uuid, p_device uuid, p_bridge text, p_max integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $function$
declare r tally_check_runs%rowtype; p tally_period_pulls%rowtype; has_p boolean; ca timestamptz; out jsonb := '[]'::jsonb; d date; lim int := least(greatest(coalesce(p_max, 1), 0), 30);
  today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_book is null or p_device is null or coalesce(p_bridge, '') = '' or lim = 0 then return out; end if;
  select * into r from tally_check_runs where book_id = p_book;
  if not found or r.state <> 'going' then return out; end if;
  select * into p from tally_period_pulls where book_id = p_book;
  has_p := found;
  if has_p and p.state = 'paused' then return out; end if;
  if has_p and p.state = 'stopped' and not (r.chosen_at > coalesce(p.stopped_at, p.chosen_at)) then return out; end if;
  ca := case when has_p and p.state = 'going' then p.chosen_at else r.chosen_at end;
  for d in select x.day from tally_check_days x
            where x.book_id = p_book and x.done_at is null and x.upload_at is null and x.day <= today
              and (x.asked_at is null or x.asked_at < now() - interval '3 minutes')
              and exists (select 1 from tally_recorder_lines l
                           where l.book_id = p_book and l.vch_date = x.day and l.state = 'held' and l.event in ('deleted', 'cancelled')
                             and (l.object_guid is null or l.object_guid ~ '-0{8}$') and l.device_id = p_device and l.bridge = p_bridge
                             and l.received_at > now() - interval '1 day')
            order by x.day desc limit lim loop
    out := out || jsonb_build_array(jsonb_build_object('day', to_char(d, 'YYYYMMDD'), 'fetch', true, 'chosenAt', ca, 'check', true, 'held', true));
  end loop;
  update tally_check_days x set asked_at = now(), first_asked_at = coalesce(x.first_asked_at, now())
   where x.book_id = p_book and x.day in (select to_date(e->>'day', 'YYYYMMDD') from jsonb_array_elements(out) e);
  return out;
end $function$;

-- ---------------------------------------------------------------- 3. the gap closed by days listed after Tally's number
-- Tally's highest voucher AlterID in a book's open gap, and when FinCom first saw it (the server's clock)
create table if not exists public.tally_gap_numbers (
  book_id   uuid primary key references public.tally_books(book_id) on delete cascade,
  firm_id   uuid not null,
  altvchid  bigint not null,
  first_at  timestamptz not null default now()
);
alter table public.tally_gap_numbers enable row level security;
grant select, insert, update, delete on public.tally_gap_numbers to service_role;

-- a gap written: its number kept (anew when the number moved, or the gap opened again since), and its days (at most 7)
-- queued for the check when none was listed whole after the number was seen; never a day being checked, nor one given up
-- (upload_at) since. Never fails what fired it
create or replace function public.tally_sync_cursor_gap_seen() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $function$
declare alt bigint; n tally_gap_numbers%rowtype; a date; z date; today date := (now() at time zone 'Asia/Kolkata')::date; want date[];
begin
  begin
    if coalesce(new.gap->>'tally_altvchid', '') !~ '^[0-9]{1,15}$' then return null; end if;
    alt := (new.gap->>'tally_altvchid')::bigint;
    select * into n from tally_gap_numbers where book_id = new.book_id;
    if n.book_id is null or n.altvchid <> alt or (new.gap_at is not null and n.first_at < new.gap_at - interval '5 seconds') then
      insert into tally_gap_numbers (book_id, firm_id, altvchid, first_at) values (new.book_id, new.firm_id, alt, now())
      on conflict (book_id) do update set altvchid = excluded.altvchid, first_at = excluded.first_at, firm_id = excluded.firm_id;
      select * into n from tally_gap_numbers where book_id = new.book_id;
    end if;
    if coalesce(new.gap->>'since', '') = '' then return null; end if;
    a := ((new.gap->>'since')::timestamptz at time zone 'Asia/Kolkata')::date; z := today;
    if a is null or a > z or z - a > 6 then return null; end if;
    want := array(select s.d::date from generate_series(a, z, interval '1 day') s(d)
                   where not exists (select 1 from tally_check_days k where k.book_id = new.book_id and k.day = s.d::date
                                       and ((k.done_at is null and k.upload_at is null)
                                            or (k.via = 'day' and k.listed_at >= n.first_at)
                                            or (k.upload_at is not null and k.upload_at >= n.first_at))));
    if coalesce(array_length(want, 1), 0) = 0 then return null; end if;
    insert into tally_check_runs (book_id, firm_id) values (new.book_id, new.firm_id) on conflict (book_id) do nothing;
    insert into tally_check_days (book_id, firm_id, day, source, queued_at)
    select new.book_id, new.firm_id, d, 'gap', now() from unnest(want) d
    on conflict (book_id, day) do update set source = excluded.source, queued_at = now(), asked_at = null, lists = 0, same = null, done_at = null, upload_at = null, upload_words = null
      where not (tally_check_days.done_at is null and tally_check_days.upload_at is null);
  exception when others then
    raise log 'tally_sync_cursor_gap_seen: book %: % %', new.book_id, sqlstate, sqlerrm;
  end;
  return null;
end $function$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.tally_sync_cursor'::regclass and tgname = 'tally_sync_cursor_gap_seen' and not tgisinternal) then
    create trigger tally_sync_cursor_gap_seen after insert or update of gap, gap_at on public.tally_sync_cursor for each row
      when (new.gap is not null) execute function public.tally_sync_cursor_gap_seen();
  end if;
end $$;

-- 150's rule, OR (158) every day of the gap listed whole and done after FinCom first saw Tally's number now, that number not
-- moved since, every number of the gap explained by a settled delete, nothing of the book held since the gap began
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
     )
$function$;

-- ---------------------------------------------------------------- 4. who may call
revoke all on function public.tally_held_delete_by_heads(uuid, date, jsonb, uuid, text), public.tally_held_front(uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.tally_held_delete_by_heads(uuid, date, jsonb, uuid, text), public.tally_held_front(uuid, uuid, text, integer) to service_role;
revoke all on function public.tally_sync_cursor_gap_seen() from public, anon, authenticated, service_role;
revoke all on function public.tally_recorder_gap_asked(uuid, timestamptz, timestamptz, timestamptz, bigint) from public, anon, authenticated;
grant execute on function public.tally_recorder_gap_asked(uuid, timestamptz, timestamptz, timestamptz, bigint) to service_role;

commit;
