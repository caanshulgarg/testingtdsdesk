-- migration-221-tally-tell.sql (24-Nov-2026, branch next-tally-tell-sql; NOT run anywhere: the coordinator applies it after
-- review). The owner, 24-Nov-2026: "There should be proper way to tell and auto import of tally days into fincom."
-- Plan: tally-tell-autoday-plan.md, part A (A.1 the causes, A.2 the computer lines, A.3.4 the bell, A.5 what the cloud
-- computes). Each linked book gets ONE plain sentence with its one action, and a line each for Reading, Posting and
-- Changes; each computer of the firm gets one line; the bell gets one 'tell' row a book, raised after 30 working minutes.
--   tally_tell_of(p_book)   the book's {cause, read, post, changes, days, since, affected, earlier} (A.1's precedence and
--                           its word table live here only; the app shows `words` as given). Nobody may call it directly.
--   tally_tell_device(id)   the computer's A.2 line. Nobody may call it directly.
--   tally_tell_view()       for the app (any active member of the firm): every book's tally_tell_of and the computers'
--                           lines (each person their own computer, owners every one). Cached 60 s by the app.
--   tally_tell_scan()       pg_cron 'tally-tell-scan' every 10 minutes (20 s budget): keeps tally_tell_state (the cause
--                           and since when), writes, updates in place or clears the 'tell' bell rows. Granted to nobody.
--   tally_alert_scan_silent() becomes a no-op keeping its name and grants (the 'tell' scan's addon_silent covers it).
-- Reads only what FinCom already holds: tally_links, tally_devices (info.beat, info.bridges[].tell as tally-ingest keeps
-- it: {skip, numbersWhy, addonSilent, unstarted, at}, version, last_seen), tally_read_serving, tally_fetch_on, tally_sync_cursor,
-- tally_check_days, tally_recorder_lines and tally_post_jobs. Nothing is sent to Tally; no bridge is asked anything.
-- 222's columns of tally_check_days (parked_at, next_at, last_why) are read through to_jsonb, so this file runs with or
-- without 222.
-- ADD-ONLY: one new table (tally_tell_state, row security on, no grants), one column added (tally_alerts.cleared_at), the
-- tally_alerts kind CHECK swapped in one ALTER for the same name with 'tell' added (only while it is exactly 47's), six new
-- functions, one function replaced (tally_alert_scan_silent, only while its text is 47's). No row deleted, nothing dropped.
-- A name guard stops the file when a name it makes is used by something that is not this migration's. One transaction,
-- lock_timeout 10 s, safe twice. Tested by tests/run_migration221.py (on tests/tell_stand.py).
begin;
set local lock_timeout = '10s';

-- ---------------------------------------------------------------- 0. the names (as migrations 206 and 208)
do $names$
declare t text; fn text; bad text[] := '{}';
begin
  foreach t in array array['tally_tell_state'] loop
    if to_regclass('public.' || t) is not null and coalesce(obj_description(to_regclass('public.' || t), 'pg_class'), '') <> 'tally tell (migration 221)' then bad := bad || ('table ' || t); end if;
  end loop;
  foreach fn in array array['tally_tell_of', 'tally_tell_device', 'tally_tell_view', 'tally_tell_scan', 'tally_tell_old', 'tally_tell_pc'] loop
    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = fn
                and coalesce(obj_description(p.oid, 'pg_proc'), '') <> 'tally tell (migration 221)') then bad := bad || ('function ' || fn); end if;
  end loop;
  -- the one function replaced: only while it is 47's text, or this migration's no-op
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'tally_alert_scan_silent'
              and not (p.oid = 'public.tally_alert_scan_silent()'::regprocedure
                       and (md5(p.prosrc) = 'a71c02a01d923ec7f0800880a88c8a29' or coalesce(obj_description(p.oid, 'pg_proc'), '') = 'tally tell (migration 221)'))) then
    bad := bad || 'function tally_alert_scan_silent (not 47''s text)'::text;
  end if;
  if to_regprocedure('public.tally_alert_scan_silent()') is null then bad := bad || 'function tally_alert_scan_silent (missing: run 47 first)'::text; end if;
  if array_length(bad, 1) > 0 then
    raise exception 'migration 221: these names are already used by something else: %. Nothing was changed.', array_to_string(bad, ', ');
  end if;
end $names$;

-- ---------------------------------------------------------------- 1. the table, the column, the kind
create table if not exists public.tally_tell_state (
  book_id uuid primary key references public.tally_books(book_id) on delete cascade,
  firm_id uuid not null,
  code    text check (code is null or length(code) <= 40),      -- the book's cause now (null: nothing to say)
  words   text check (words is null or length(words) <= 300),
  since   timestamptz,                                          -- when this cause began (the bell waits 30 working minutes)
  at      timestamptz not null default now()                    -- last scanned
);
comment on table public.tally_tell_state is 'tally tell (migration 221)';
alter table public.tally_tell_state enable row level security;
revoke all on table public.tally_tell_state from public, anon, authenticated, service_role;

alter table public.tally_alerts add column if not exists cleared_at timestamptz;    -- a 'tell' row whose cause has gone

-- tally_alerts.kind: the one CHECK swapped for the same name with 'tell' added, in one statement, only while it is exactly
-- 47's (gap, silent, summary); anything else stops the file with words (as 47 did for tally_jobs.kind)
do $kind$
declare old_def constant text := 'CHECK ((kind = ANY (ARRAY[''gap''::text, ''silent''::text, ''summary''::text])))';
  new_def constant text := 'CHECK ((kind = ANY (ARRAY[''gap''::text, ''silent''::text, ''summary''::text, ''tell''::text])))';
  c text; n int; found text;
begin
  if exists (select 1 from pg_constraint con where con.conrelid = 'public.tally_alerts'::regclass and con.contype = 'c' and pg_get_constraintdef(con.oid) = new_def) then return; end if;
  select count(*), min(con.conname) into n, c from pg_constraint con
   where con.conrelid = 'public.tally_alerts'::regclass and con.contype = 'c' and pg_get_constraintdef(con.oid) = old_def;
  if n = 1 then
    execute format('alter table public.tally_alerts drop constraint %I, add constraint %I check (kind in (''gap'', ''silent'', ''summary'', ''tell''))', c, c);
  else
    select string_agg(con.conname || ' ' || pg_get_constraintdef(con.oid), '; ') into found from pg_constraint con
     where con.conrelid = 'public.tally_alerts'::regclass and con.contype = 'c' and pg_get_constraintdef(con.oid) ~ '\mkind\M';
    raise exception 'migration 221 stopped, nothing changed: tally_alerts has no CHECK on kind exactly as migration 47 made it (gap, silent, summary) (found: %). Widen it by hand to take tell, then run 221 again', coalesce(found, 'none');
  end if;
end $kind$;

-- ---------------------------------------------------------------- 2. helpers (granted to nobody)
-- a bridge older than 2.5.16 (TELL_MIN_BRIDGE: the typing clock and dayRetry auto-days rely on); a version FinCom cannot read: not old
create or replace function public.tally_tell_old(p_version text) returns boolean
language sql immutable security definer set search_path = public, pg_temp as $function$
  select case when coalesce(p_version, '') ~ '^v?[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,6}'
    then (regexp_match(p_version, '^v?([0-9]{1,4})\.([0-9]{1,4})\.([0-9]{1,6})'))::int[] < array[2, 5, 16] else false end
$function$;
comment on function public.tally_tell_old(text) is 'tally tell (migration 221)';

-- a computer's short label: its name without the Windows domain (DOMAIN\NAME, NAME.domain.local)
create or replace function public.tally_tell_pc(p_name text) returns text
language sql immutable security definer set search_path = public, pg_temp as $function$
  select coalesce(nullif(split_part(regexp_replace(btrim(coalesce(p_name, '')), '^.*\\', ''), '.', 1), ''), 'this computer')
$function$;
comment on function public.tally_tell_pc(text) is 'tally tell (migration 221)';

-- ---------------------------------------------------------------- 3. the book's sentence (A.1)
-- Precedence (A.1): 1 not_linked, 2 no_bridge, 3 bridge_off, 4 old_bridge, 5 tally_closed, 6 not_open, 7 run_as_admin,
-- 8 two_tallys, 9 other_login, 10 other_copy, 11 reading_off, 12 paused / read_stopped, 13 no_start, 14 addon_silent,
-- 15 days_waiting, 16 slow_day; the first that applies wins. Where nothing serves the book, a bridge's own word (skip:
-- ownerUnknown / twoTallys / otherLogin / otherCopy, or a pickup refused otherLogin / otherCompany) names the cause 7-10
-- before 5 and 6 (it proves Tally runs, and says why the company cannot be read). Reading (R) stops on 1-13, Posting (P) on
-- 1-3 and 5-10 (said only as "Entries go to Tally when <co> is open in Tally."), Changes (C) on 1-4, 7, 11-14.
create or replace function public.tally_tell_of(p_book uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $function$
declare b tally_books%rowtype; l tally_links%rowtype; cur tally_sync_cursor%rowtype; st tally_tell_state%rowtype; f uuid; co text; g text; hl boolean;
  today date := (now() at time zone 'Asia/Kolkata')::date; brs jsonb; cand jsonb; live jsonb; srv jsonb; sv jsonb;
  top int; code text; words text; fix text; c14 boolean := false; w14 text; skipc text; numw text; pick text;
  n_ready int := 0; n_all int := 0; d_old date; slow_d date; fetching int := 0; posting int := 0; alt bigint; e jsonb; ey text; en int;
  r_code text; p_code text; c_code text; cause jsonb; j15 jsonb; j16 jsonb; o jsonb;
  stops_r constant int[] := array[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
  stops_p constant int[] := array[1, 2, 3, 5, 6, 7, 8, 9, 10];
  stops_c constant int[] := array[1, 2, 3, 4, 7, 11, 12, 13];
  CODES constant text[] := array['not_linked', 'no_bridge', 'bridge_off', 'old_bridge', 'tally_closed', 'not_open', 'run_as_admin', 'two_tallys', 'other_login',
                                 'other_copy', 'reading_off', 'paused', 'no_start', 'addon_silent', 'days_waiting', 'slow_day'];
begin
  select * into b from tally_books where book_id = p_book;
  if not found then return null; end if;
  f := b.firm_id;
  select * into l from tally_links x where x.book_id = p_book and x.firm_id = f and x.state = 'linked' order by x.linked_at desc nulls last limit 1;
  hl := found;
  co := coalesce((select c.company from tally_companies c where c.firm_id = f and c.book_id = p_book order by c.last_seen desc nulls last limit 1), l.company_name, b.company, 'this company');
  g := nullif(lower(btrim(coalesce(l.company_guid, ''))), '');
  select * into cur from tally_sync_cursor where book_id = p_book;

  -- the days FinCom brings for the book (not parked; from the book's first day to today), and those held back after a 2 s stop
  select count(*)::int, count(*) filter (where coalesce((to_jsonb(x) ->> 'next_at')::timestamptz, '-infinity') <= now())::int, min(x.day),
         max(x.day) filter (where coalesce((to_jsonb(x) ->> 'next_at')::timestamptz, '-infinity') > now() and to_jsonb(x) ->> 'last_why' in ('slow', 'dayRetry', 'over2s', 'window', 'stopped', 'unfinished'))
    into n_all, n_ready, d_old, slow_d
    from tally_check_days x
   where x.book_id = p_book and x.done_at is null and x.upload_at is null and to_jsonb(x) ->> 'parked_at' is null
     and x.day <= today and (b.from_date is null or x.day >= b.from_date);
  select count(*)::int into fetching from tally_recorder_lines r where r.book_id = p_book and r.state = 'fetching';
  select count(*)::int into posting from tally_post_jobs j where j.firm_id = f and j.client_id = b.client_id and j.status in ('waiting', 'taken', 'running');
  -- the last pickup refusal of an open day of the book in the last day (222's last_why)
  select to_jsonb(x) ->> 'last_why' into pick from tally_check_days x
   where x.book_id = p_book and x.done_at is null and x.upload_at is null and to_jsonb(x) ->> 'last_why' in ('otherLogin', 'otherCompany') and x.asked_at > now() - interval '1 day'
   order by x.asked_at desc limit 1;

  if not hl then
    top := 1;
  elsif not exists (select 1 from tally_devices d where d.firm_id = f and not coalesce(d.revoked, false) and d.last_seen > now() - interval '7 days') then
    top := 2;
  end if;

  if top is null then
    -- every bridge of the firm heard in 7 days, with what its last beat says of this company
    select coalesce(jsonb_agg(jsonb_build_object(
             'device', d.id, 'bridge', k.key, 'at', k.value ->> 'at',
             'live', (k.value ->> 'at')::timestamptz > now() - interval '3 minutes',
             'recent', (k.value ->> 'at')::timestamptz > now() - interval '1 hour',
             'old', tally_tell_old(coalesce(nullif(k.value ->> 'version', ''), d.version)),
             'closed', coalesce(k.value ->> 'tallyState', bt.v ->> 'tallyState', '') = 'closed' or coalesce(bt.v ->> 'tallyWhy', '') = 'no Tally running in this login',
             'paused', coalesce(bt.v ->> 'paused', '') = 'true',
             'stopped', jsonb_typeof(k.value -> 'readStopped') = 'object' or jsonb_typeof(d.info -> 'readStop') = 'object',
             'open', exists (select 1 from jsonb_array_elements(case when jsonb_typeof(k.value -> 'cos') = 'array' then k.value -> 'cos' else '[]'::jsonb end) c
                              where jsonb_typeof(c) = 'array' and lower(tally_nm(c ->> 0)) = lower(tally_nm(co))),
             'openGuid', g is not null and exists (select 1 from jsonb_array_elements(case when jsonb_typeof(k.value -> 'cos') = 'array' then k.value -> 'cos' else '[]'::jsonb end) c
                              where jsonb_typeof(c) = 'array' and lower(tally_nm(c ->> 0)) = lower(tally_nm(co)) and lower(btrim(coalesce(c ->> 1, ''))) = g),
             'sees', exists (select 1 from jsonb_array_elements(case when jsonb_typeof(k.value -> 'cos') = 'array' then k.value -> 'cos' else '[]'::jsonb end) c
                              where jsonb_typeof(c) = 'array' and (lower(tally_nm(c ->> 0)) = lower(tally_nm(co)) or (g is not null and lower(btrim(coalesce(c ->> 1, ''))) = g)))
                  or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(bt.v -> 'companies') = 'array' then bt.v -> 'companies' else '[]'::jsonb end) c
                              where jsonb_typeof(c) = 'object' and (lower(tally_nm(c ->> 'name')) = lower(tally_nm(co)) or (g is not null and lower(btrim(coalesce(c ->> 'guid', ''))) = g))),
             'alt', (select max((c ->> 'altvchid')::bigint) from jsonb_array_elements(case when jsonb_typeof(bt.v -> 'companies') = 'array' then bt.v -> 'companies' else '[]'::jsonb end) c
                      where jsonb_typeof(c) = 'object' and coalesce(c ->> 'altvchid', '') ~ '^[0-9]{1,15}$'
                        and (lower(tally_nm(c ->> 'name')) = lower(tally_nm(co)) or (g is not null and lower(btrim(coalesce(c ->> 'guid', ''))) = g))),
             'skip', (select s.value from jsonb_each_text(case when jsonb_typeof(k.value -> 'tell' -> 'skip') = 'object' then k.value -> 'tell' -> 'skip' else '{}'::jsonb end) s
                       where lower(tally_nm(s.key)) = lower(tally_nm(co)) limit 1),
             'numbersWhy', (select s.value from jsonb_each_text(case when jsonb_typeof(k.value -> 'tell' -> 'numbersWhy') = 'object' then k.value -> 'tell' -> 'numbersWhy' else '{}'::jsonb end) s
                       where lower(tally_nm(s.key)) = lower(tally_nm(co)) limit 1),
             'addon', (select a ->> 'reason' from jsonb_array_elements(case when jsonb_typeof(k.value -> 'tell' -> 'addonSilent') = 'array' then k.value -> 'tell' -> 'addonSilent' else '[]'::jsonb end) a
                       where jsonb_typeof(a) = 'object' and (lower(tally_nm(a ->> 'company')) = lower(tally_nm(co)) or (g is not null and lower(btrim(coalesce(a ->> 'guid', ''))) = g)) limit 1),
             -- tally-ingest's own word: the company handed no day for want of a starting point ({why: noNumbers | noStart, since})
             'unstartedSince', (select case when coalesce(u.value ->> 'since', '') ~ '^\d{4}-\d\d-\d\d' then u.value ->> 'since' else k.value ->> 'at' end
                                  from jsonb_each(case when jsonb_typeof(k.value -> 'tell' -> 'unstarted') = 'object' then k.value -> 'tell' -> 'unstarted' else '{}'::jsonb end) u
                                 where lower(tally_nm(u.key)) = lower(tally_nm(co)) limit 1),
             'fetchOn', tally_fetch_on(d.id))), '[]'::jsonb)
      into brs
      from tally_devices d
      cross join lateral jsonb_each(case when jsonb_typeof(d.info -> 'bridges') = 'object' then d.info -> 'bridges' else '{}'::jsonb end) k
      cross join lateral (select case when coalesce(d.info -> 'beat' ->> 'bridge', k.key) = k.key and jsonb_typeof(d.info -> 'beat') = 'object' then d.info -> 'beat' else '{}'::jsonb end as v) bt
     where d.firm_id = f and not coalesce(d.revoked, false) and k.key ~ '^go-[0-9a-f]{6,32}$' and jsonb_typeof(k.value) = 'object'
       and coalesce(k.value ->> 'mode', '') <> 'test' and coalesce(k.value ->> 'at', '') ~ '^\d{4}-\d\d-\d\dT\d\d:\d\d'
       and (k.value ->> 'at')::timestamptz > now() - interval '7 days';
    -- the bridges that saw the company in 7 days; none: every bridge of the firm
    select coalesce(jsonb_agg(x), '[]'::jsonb) into cand from jsonb_array_elements(brs) x where (x ->> 'sees')::boolean;
    if jsonb_array_length(cand) = 0 then cand := brs; end if;
    select coalesce(jsonb_agg(x), '[]'::jsonb) into live from jsonb_array_elements(cand) x where (x ->> 'live')::boolean;
    srv := tally_read_serving(f, p_book);
    select coalesce(jsonb_agg(x), '[]'::jsonb) into sv from jsonb_array_elements(brs) x
     where exists (select 1 from jsonb_array_elements(srv) s where s ->> 'device' = x ->> 'device' and s ->> 'bridge' = x ->> 'bridge');
    if jsonb_array_length(brs) = 0 then
      -- a computer beating with no FinCom Bridge 2 id (a first-generation bridge): heard in 3 minutes, an old bridge
      top := case when exists (select 1 from tally_devices d where d.firm_id = f and not coalesce(d.revoked, false) and d.last_seen > now() - interval '3 minutes') then 4 else 3 end;
    elsif jsonb_array_length(live) = 0 and jsonb_array_length(sv) = 0 then
      top := 3;
    elsif not exists (select 1 from jsonb_array_elements(case when jsonb_array_length(sv) > 0 then sv else live end) x where not (x ->> 'old')::boolean) then
      top := 4;
    elsif jsonb_array_length(sv) = 0 then
      select x ->> 'skip' into skipc from jsonb_array_elements(live) x where x ->> 'skip' in ('ownerUnknown', 'twoTallys', 'otherLogin', 'otherCopy')
       order by array_position(array['ownerUnknown', 'twoTallys', 'otherLogin', 'otherCopy'], x ->> 'skip') limit 1;
      top := case
        when exists (select 1 from jsonb_array_elements(live) x where (x ->> 'openGuid')::boolean and (x ->> 'stopped')::boolean) then 12
        when skipc = 'ownerUnknown' then 7 when skipc = 'twoTallys' then 8 when skipc = 'otherLogin' or pick = 'otherLogin' then 9
        when skipc = 'otherCopy' or pick = 'otherCompany' then 10
        when not exists (select 1 from jsonb_array_elements(live) x where not (x ->> 'closed')::boolean) then 5
        when exists (select 1 from jsonb_array_elements(live) x where (x ->> 'open')::boolean) then 10
        else 6 end;
      if top = 12 then code := 'read_stopped'; end if;
    else
      select x ->> 'numbersWhy' into numw from jsonb_array_elements(sv) x where x ->> 'numbersWhy' in ('ownerUnknown', 'twoTallys') limit 1;
      top := case
        when exists (select 1 from jsonb_array_elements(sv) x where x ->> 'skip' = 'twoTallys') then 8
        when not exists (select 1 from jsonb_array_elements(sv) x where (x ->> 'fetchOn')::boolean) then 11
        when not exists (select 1 from jsonb_array_elements(sv) x where not (x ->> 'paused')::boolean) then 12
        when (cur.start_at is null and coalesce(l.linked_at, '-infinity') < now() - interval '10 minutes'
              and not exists (select 1 from jsonb_array_elements(sv) x where coalesce((x ->> 'alt')::bigint, 0) > 0))
          or exists (select 1 from jsonb_array_elements(live) x where (x ->> 'unstartedSince')::timestamptz < now() - interval '10 minutes') then
             case numw when 'ownerUnknown' then 7 when 'twoTallys' then 8 else 13 end
        end;
      if top = 12 then code := 'paused'; end if;
    end if;
    -- 14: Tally's number ahead of the add-on's last line for 2 working hours while a bridge that serves the book sees it open
    if jsonb_array_length(sv) > 0 or exists (select 1 from jsonb_array_elements(brs) x where (x ->> 'openGuid')::boolean and (x ->> 'recent')::boolean) then
      alt := greatest((select max((x ->> 'alt')::bigint) from jsonb_array_elements(case when jsonb_array_length(sv) > 0 then sv else brs end) x),
                      case when coalesce(cur.gap ->> 'tally_altvchid', '') ~ '^[0-9]{1,15}$' then (cur.gap ->> 'tally_altvchid')::bigint end);
      if alt > coalesce(cur.recorder_max_alter, 0) and coalesce(cur.recorder_last_at, cur.start_at) is not null
         and tally_working_hours(coalesce(cur.recorder_last_at, cur.start_at), now()) >= 2 then
        c14 := true;
        w14 := case when exists (select 1 from jsonb_array_elements(brs) x where x ->> 'addon' = 'addonAdded')
                    then 'Close and open Tally once, so it loads the FinCom add-on.'
                    else 'Load the FinCom add-on in Tally (F1 › TDLs & Add-ons).' end;
      end if;
    end if;
  end if;

  -- the words (A.1's table; at most 14 words a sentence, <co> counted as one; no computer or user names)
  words := case top
    when 1 then format('Link %s to its client to bring its books.', co)
    when 2 then 'Install FinCom Bridge on the computer where you use Tally.'
    when 3 then 'Start FinCom Bridge on the computer where you use Tally.'
    when 4 then 'Update FinCom Bridge on the computer where you use Tally.'
    when 5 then format('Tally is closed. Open %s in Tally.', co)
    when 6 then format('Open %s in Tally.', co)
    when 7 then format('Open %s in your own Tally, not with ''Run as administrator''.', co)
    when 8 then format('%s is open in two Tallys. Close it in one.', co)
    when 9 then format('%s is open in another person''s Windows login. Open it in yours.', co)
    when 10 then format('The %s open in Tally is another copy. Open the linked one.', co)
    when 11 then 'Reading from Tally is off for this computer. Turn it on.'
    when 12 then case when code = 'read_stopped' then 'Reading was stopped from FinCom. Resume it.' else 'Reading is paused in the FinCom Bridge tray icon. Click Resume there.' end
    when 13 then format('Open %s in your own Tally once, so FinCom can start reading it.', co)
  end;
  fix := case top when 1 then 'link' when 2 then 'download' when 4 then 'update' when 11 then 'turn_on' when 12 then case when code = 'read_stopped' then 'resume' end end;
  if top is not null then code := coalesce(code, CODES[top]); end if;

  r_code := case when top = any (stops_r) then code when n_ready > 0 then 'days_waiting' when slow_d is not null then 'slow_day' end;
  p_code := case when top = any (stops_p) then code end;
  c_code := case when top = any (stops_c) then code when c14 then 'addon_silent' end;
  j15 := jsonb_build_object('code', 'days_waiting', 'words', format('FinCom is bringing %s %s from Tally.', n_all, case when n_all = 1 then 'day' else 'days' end), 'fix', null);
  j16 := jsonb_build_object('code', 'slow_day', 'words', format('Tally was slow for %s. FinCom tries it again by itself.', to_char(slow_d, 'DD-Mon-YYYY')), 'fix', null);
  cause := case
    when top is not null then jsonb_build_object('code', code, 'words', words, 'fix', fix)
    when c14 then jsonb_build_object('code', 'addon_silent', 'words', w14, 'fix', null)
    when n_ready > 0 then j15
    when slow_d is not null then j16
    else jsonb_build_object('code', null, 'words', null, 'fix', null) end;

  select * into st from tally_tell_state where book_id = p_book;
  o := jsonb_build_object(
    'book', p_book, 'client', b.client_id, 'company', co,
    'cause', cause,
    'read', case when r_code is null then jsonb_build_object('code', null, 'words', null, 'fix', null)
                 when r_code = 'days_waiting' then j15 when r_code = 'slow_day' then j16
                 else jsonb_build_object('code', code, 'words', words, 'fix', fix) end,
    'post', case when p_code is null then jsonb_build_object('code', null, 'words', null, 'fix', null)
                 else jsonb_build_object('code', p_code, 'words', format('Entries go to Tally when %s is open in Tally.', co), 'fix', null) end,
    'changes', case when c_code is null then jsonb_build_object('code', null, 'words', null, 'fix', null)
                    when c_code = code then jsonb_build_object('code', code, 'words', words, 'fix', fix)
                    else jsonb_build_object('code', 'addon_silent', 'words', w14, 'fix', null) end,
    'days', jsonb_build_object('n', n_all, 'oldest', to_char(d_old, 'YYYY-MM-DD')),
    'since', case when st.code is not distinct from (cause ->> 'code') and cause ->> 'code' is not null then st.since end,
    'affected', n_all > 0 or fetching > 0 or posting > 0 or coalesce(alt > coalesce(cur.recorder_max_alter, 0), false));
  -- B.8: changes in Tally dated before the book's first day, of a year no book of the client covers: said once, with the
  -- existing add-year step (the lines were closed by 222 with "a year FinCom does not keep")
  select (case when extract(month from r.vch_date) >= 4 then extract(year from r.vch_date) else extract(year from r.vch_date) - 1 end)::int::text, count(*)::int
    into ey, en
    from tally_recorder_lines r
   where r.book_id = p_book and b.from_date is not null and r.vch_date < b.from_date and r.state in ('stale', 'fetching') and r.received_at > now() - interval '400 days'
     and not exists (select 1 from tally_books k where k.firm_id = f and k.client_id = b.client_id and k.book_id <> p_book and k.from_date is not null
                       and k.from_date <= r.vch_date)
   group by 1 order by 1 desc limit 1;
  if en > 0 then
    ey := ey || '-' || lpad(((ey::int + 1) % 100)::text, 2, '0');
    o := o || jsonb_build_object('earlier', jsonb_build_object('fy', ey, 'n', en, 'words', format('%s has changes in Tally for %s. Add %s to bring them.', co, ey, ey), 'fix', 'add_year'));
  end if;
  return o;
end $function$;
comment on function public.tally_tell_of(uuid) is 'tally tell (migration 221)';

-- ---------------------------------------------------------------- 4. the computer's line (A.2), from its own beat
create or replace function public.tally_tell_device(p_device uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $function$
declare d tally_devices%rowtype; bt jsonb; pc text; code text; words text; fix text; guids text[]; names text[];
begin
  select * into d from tally_devices where id = p_device and not coalesce(revoked, false);
  if not found then return null; end if;
  bt := case when jsonb_typeof(d.info -> 'beat') = 'object' then d.info -> 'beat' else '{}'::jsonb end;
  pc := tally_tell_pc(coalesce(nullif(btrim(d.info ->> 'computer'), ''), d.name));
  select array_agg(lower(btrim(x.company_guid))) filter (where x.company_guid is not null), array_agg(lower(tally_nm(x.company_name))) filter (where x.company_name is not null)
    into guids, names from tally_links x where x.firm_id = d.firm_id and x.state = 'linked';
  if d.last_seen is null or d.last_seen < now() - interval '3 minutes' then
    code := 'bridge_off'; words := format('FinCom Bridge is not running on %s.', pc);
  elsif tally_tell_old(coalesce(nullif(bt ->> 'version', ''), d.version)) then
    code := 'old_bridge'; words := format('Update FinCom Bridge on %s.', pc); fix := 'update';
  elsif coalesce(bt ->> 'tallyState', '') = 'closed' or coalesce(bt ->> 'tallyWhy', '') = 'no Tally running in this login' then
    code := 'tally_closed'; words := format('Tally is closed on %s.', pc);
  elsif exists (select 1 from jsonb_array_elements(case when jsonb_typeof(bt -> 'ports') = 'array' then bt -> 'ports' else '[]'::jsonb end) p where jsonb_typeof(p) = 'object' and p ->> 'owner' = 'unknown')
     or exists (select 1 from jsonb_each(case when jsonb_typeof(d.info -> 'bridges') = 'object' then d.info -> 'bridges' else '{}'::jsonb end) k,
                       jsonb_each_text(case when jsonb_typeof(k.value -> 'tell' -> 'skip') = 'object' then k.value -> 'tell' -> 'skip' else '{}'::jsonb end) s where s.value = 'ownerUnknown') then
    code := 'run_as_admin'; words := format('Tally on %s runs as administrator. Open it normally.', pc);
  elsif exists (select 1 from jsonb_array_elements(case when jsonb_typeof(bt -> 'tallyIni') = 'array' then bt -> 'tallyIni' else '[]'::jsonb end) i where jsonb_typeof(i) = 'object' and i ->> 'state' = 'shared')
    and exists (select 1 from jsonb_array_elements(case when jsonb_typeof(bt -> 'companies') = 'array' then bt -> 'companies' else '[]'::jsonb end) c
                 where jsonb_typeof(c) = 'object' and coalesce(c ->> 'open', '') = 'true'
                   and (lower(btrim(coalesce(c ->> 'guid', ''))) = any (coalesce(guids, '{}')) or lower(tally_nm(c ->> 'name')) = any (coalesce(names, '{}')))) then
    code := 'addon'; words := format('Load the FinCom add-on in Tally on %s (F1 › TDLs & Add-ons).', pc);
  elsif coalesce(bt ->> 'paused', '') = 'true' then
    code := 'paused'; words := format('Reading is paused on %s.', pc);
  else
    code := 'working'; words := 'Working.';
  end if;
  return jsonb_build_object('device', d.id, 'computer', pc, 'code', code, 'words', words, 'fix', fix, 'at', d.last_seen);
end $function$;
comment on function public.tally_tell_device(uuid) is 'tally tell (migration 221)';

-- ---------------------------------------------------------------- 5. the app: every book's sentence, the computers' lines
create or replace function public.tally_tell_view() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); own boolean; bks jsonb; pcs jsonb;
begin
  if f is null or not exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and coalesce(m.active, true)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  own := exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and coalesce(m.active, true) and m.role = 'owner');
  -- every linked book; a book no longer linked only while it has days waiting or lines being fetched (cause 1)
  select coalesce(jsonb_agg(tally_tell_of(b.book_id) order by b.company, b.from_date desc, b.book_id), '[]'::jsonb) into bks
    from tally_books b
   where b.firm_id = f
     and (exists (select 1 from tally_links x where x.book_id = b.book_id and x.firm_id = f and x.state = 'linked')
          or exists (select 1 from tally_check_days x where x.book_id = b.book_id and x.done_at is null and x.upload_at is null)
          or exists (select 1 from tally_recorder_lines r where r.book_id = b.book_id and r.state = 'fetching'));
  select coalesce(jsonb_agg(tally_tell_device(d.id) || jsonb_build_object('mine', d.created_by = auth.uid()
                     or exists (select 1 from tally_member_bridges mb where mb.firm_id = f and mb.user_id = auth.uid() and mb.device_id = d.id))
                   order by d.last_seen desc nulls last, d.id), '[]'::jsonb) into pcs
    from tally_devices d
   where d.firm_id = f and not coalesce(d.revoked, false) and d.last_seen > now() - interval '30 days'
     and (own or d.created_by = auth.uid() or exists (select 1 from tally_member_bridges mb where mb.firm_id = f and mb.user_id = auth.uid() and mb.device_id = d.id));
  return jsonb_build_object('ok', true, 'at', now(), 'books', bks, 'computers', pcs);
end $function$;
comment on function public.tally_tell_view() is 'tally tell (migration 221)';

-- ---------------------------------------------------------------- 6. the scan: the cause's since, the bell (A.3.4)
-- One 'tell' row a book (open while cleared_at is null): raised only after the cause (1-14) has lasted 30 working minutes
-- and something is affected (days waiting, lines fetching, a posting waiting, Tally's number moving); written in place
-- when the cause changes; cleared_at when it goes. 15 and 16 are not faults: never a bell. At most 20 s a run.
create or replace function public.tally_tell_scan() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $function$
declare t0 timestamptz := clock_timestamp(); today date := (now() at time zone 'Asia/Kolkata')::date; bk record; t jsonb; c text; w text; st tally_tell_state%rowtype;
  a tally_alerts%rowtype; nb int := 0; nr int := 0; nu int := 0; nc int := 0; bad int := 0; left_n int := 0; fault boolean;
begin
  for bk in select b.book_id, b.firm_id, b.client_id from tally_books b
             where exists (select 1 from tally_links x where x.book_id = b.book_id and x.firm_id = b.firm_id and x.state = 'linked')
                or exists (select 1 from tally_check_days x where x.book_id = b.book_id and x.done_at is null and x.upload_at is null)
                or exists (select 1 from tally_alerts x where x.book_id = b.book_id and x.kind = 'tell' and x.cleared_at is null)
                or exists (select 1 from tally_tell_state x where x.book_id = b.book_id and x.code is not null)
             order by (select x.at from tally_tell_state x where x.book_id = b.book_id) nulls first, b.book_id loop
    if clock_timestamp() - t0 > interval '20 seconds' then left_n := left_n + 1; continue; end if;
    begin
      t := tally_tell_of(bk.book_id);
      c := t -> 'cause' ->> 'code'; w := t -> 'cause' ->> 'words';
      select * into st from tally_tell_state where book_id = bk.book_id;
      insert into tally_tell_state as s (book_id, firm_id, code, words, since, at) values (bk.book_id, bk.firm_id, c, w, case when c is not null then now() end, now())
      on conflict (book_id) do update set code = excluded.code, words = excluded.words, at = now(),
        since = case when s.code is not distinct from excluded.code then s.since else excluded.since end;
      select * into st from tally_tell_state where book_id = bk.book_id;
      fault := c is not null and c not in ('days_waiting', 'slow_day');
      select * into a from tally_alerts x where x.firm_id = bk.firm_id and x.kind = 'tell' and x.book_id = bk.book_id and x.cleared_at is null order by x.id desc limit 1;
      if a.id is not null then
        if not fault then
          update tally_alerts set cleared_at = now() where id = a.id; nc := nc + 1;
        elsif a.words is distinct from w then
          update tally_alerts set words = w, data = jsonb_build_object('code', c, 'fix', t -> 'cause' ->> 'fix', 'since', st.since), at = now(), read_at = null, read_by = null where id = a.id;
          nu := nu + 1;
        end if;
      elsif fault and coalesce((t ->> 'affected')::boolean, false) and st.since is not null and tally_working_hours(st.since, now()) >= 0.5 then
        insert into tally_alerts (firm_id, client_id, book_id, device_id, kind, day, words, data)
        values (bk.firm_id, bk.client_id, bk.book_id, null, 'tell', today, w, jsonb_build_object('code', c, 'fix', t -> 'cause' ->> 'fix', 'since', st.since))
        on conflict (firm_id, kind, (coalesce(book_id, '00000000-0000-0000-0000-000000000000'::uuid)), (coalesce(device_id, '00000000-0000-0000-0000-000000000000'::uuid)), day)
        do update set words = excluded.words, data = excluded.data, at = now(), cleared_at = null, read_at = null, read_by = null;
        nr := nr + 1;
      end if;
      nb := nb + 1;
    exception when others then
      bad := bad + 1; raise log 'tally_tell_scan: book %: % %', bk.book_id, sqlstate, sqlerrm;
    end;
  end loop;
  return jsonb_build_object('ok', true, 'books', nb, 'raised', nr, 'updated', nu, 'cleared', nc)
         || case when bad > 0 then jsonb_build_object('booksFailed', bad) else '{}'::jsonb end
         || case when left_n > 0 then jsonb_build_object('left', left_n) else '{}'::jsonb end;
end $function$;
comment on function public.tally_tell_scan() is 'tally tell (migration 221)';

-- ---------------------------------------------------------------- 7. the per-computer silent scan: a no-op (A.3.4)
-- the 'tell' scan's addon_silent (per book) covers it: one bell row, not two. Its name, job and grants are kept.
create or replace function public.tally_alert_scan_silent()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
begin
  return jsonb_build_object('ok', true, 'written', 0, 'skipped', 'replaced by the tally-tell scan (migration 221)');
end $function$;
comment on function public.tally_alert_scan_silent() is 'tally tell (migration 221)';

-- ---------------------------------------------------------------- 8. grants (explicit)
revoke all on function public.tally_tell_old(text) from public, anon, authenticated, service_role;
revoke all on function public.tally_tell_pc(text) from public, anon, authenticated, service_role;
revoke all on function public.tally_tell_of(uuid) from public, anon, authenticated, service_role;
revoke all on function public.tally_tell_device(uuid) from public, anon, authenticated, service_role;
revoke all on function public.tally_tell_scan() from public, anon, authenticated, service_role;
revoke all on function public.tally_alert_scan_silent() from public, anon, authenticated, service_role;
revoke all on function public.tally_tell_view() from public, anon, service_role;
grant execute on function public.tally_tell_view() to authenticated;

-- ---------------------------------------------------------------- 9. the job (pg_cron where it is there)
do $cron$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise notice 'migration 221: pg_cron is not here: the tell scan is not scheduled (call tally_tell_scan yourself)';
  else
    perform cron.schedule('tally-tell-scan', '4-59/10 * * * *', 'select public.tally_tell_scan()');     -- every 10 minutes
  end if;
end $cron$;

commit;
